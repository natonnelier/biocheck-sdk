import { createWorker, OEM, PSM, type Worker as TesseractWorker } from "tesseract.js";
import { MRZ_WHITELIST } from "../config.js";
import { BiocheckError } from "../errors.js";
import type { DocumentType, ResolvedConfig } from "../types.js";
import { otsuThreshold, parseMrz, stripGeometry, toGray } from "./mrz.js";

export interface OcrUrls {
  worker: string;
  core: string;
  /** URL of `<lang>.traineddata`. */
  lang: string;
}

/**
 * MRZ reader on the main thread. Tesseract.js runs in its own worker; the
 * cheap crop/grayscale/resize/Otsu steps run here (thesis 3.3.3).
 */
export class MrzReader {
  private constructor(
    private readonly worker: TesseractWorker,
    private readonly doc: ResolvedConfig["document"]
  ) {}

  static async create(urls: OcrUrls, doc: ResolvedConfig["document"]): Promise<MrzReader> {
    const slash = urls.lang.lastIndexOf("/");
    const langPath = urls.lang.slice(0, slash);
    const lang = urls.lang.slice(slash + 1).replace(/\.traineddata$/, "");
    try {
      const worker = await createWorker(lang, OEM.LSTM_ONLY, {
        workerPath: urls.worker,
        corePath: urls.core,
        langPath,
        gzip: false,
        // Default would persist the traineddata in IndexedDB; the SDK
        // persists nothing (out of scope: any storage).
        cacheMethod: "none",
        workerBlobURL: false,
      });
      await worker.setParameters({
        tessedit_char_whitelist: MRZ_WHITELIST,
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });
      return new MrzReader(worker, doc);
    } catch (e) {
      throw new BiocheckError("model_load_failed", `Tesseract.js: ${String(e)}`);
    }
  }

  /** True when the image yields an MRZ of the right format with valid check digits. */
  async read(image: ImageBitmap, docType: DocumentType): Promise<boolean> {
    const canvas = preprocessStrip(image, docType, this.doc);
    const { data } = await this.worker.recognize(canvas);
    // Only validity leaves this function; the parsed fields are dropped here.
    return parseMrz(data.text, docType) !== null;
  }

  async terminate(): Promise<void> {
    await this.worker.terminate();
  }
}

/** Bottom strip → grayscale → smooth resize to the target char height → Otsu. */
function preprocessStrip(
  image: ImageBitmap,
  docType: DocumentType,
  doc: ResolvedConfig["document"]
): HTMLCanvasElement {
  const g = stripGeometry(image.height, docType, doc);
  const w = image.width;

  const strip = document.createElement("canvas");
  strip.width = w;
  strip.height = g.sh;
  const sctx = strip.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(image, 0, g.sy, w, g.sh, 0, 0, w, g.sh);
  const src = sctx.getImageData(0, 0, w, g.sh);
  writeGray(src.data, toGray(src.data));
  sctx.putImageData(src, 0, 0);

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w * g.scale));
  out.height = Math.max(1, Math.round(g.sh * g.scale));
  const octx = out.getContext("2d", { willReadFrequently: true })!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(strip, 0, 0, out.width, out.height);

  const scaled = octx.getImageData(0, 0, out.width, out.height);
  const gray = toGray(scaled.data);
  const t = otsuThreshold(gray);
  for (let i = 0; i < gray.length; i++) gray[i] = gray[i] > t ? 255 : 0;
  writeGray(scaled.data, gray);
  octx.putImageData(scaled, 0, 0);
  return out;
}

function writeGray(rgba: Uint8ClampedArray, gray: Uint8Array): void {
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    rgba[i] = rgba[i + 1] = rgba[i + 2] = gray[j];
    rgba[i + 3] = 255;
  }
}
