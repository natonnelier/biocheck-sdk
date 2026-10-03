import { createWorker, PSM, type Worker as TesseractWorker } from "tesseract.js";
import { parse as parseMRZ } from "mrz";
import { OCR } from "../config.js";
import type { MRZData } from "../types.js";

let ocrWorker: TesseractWorker | null = null;

export async function initOCR(modelsBaseUrl: string): Promise<void> {
  ocrWorker = await createWorker("ocrb_int", 1, {
    workerPath: `${modelsBaseUrl}/tesseract/worker.min.js`,
    langPath: `${modelsBaseUrl}/tesseract/lang-data`,
    corePath: `${modelsBaseUrl}/tesseract/tesseract-core.wasm.js`,
  });

  await ocrWorker.setParameters({
    tessedit_char_whitelist: OCR.WHITELIST,
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
  });
}

/**
 * Extracts MRZ lines from the bottom strip of a document image.
 * Returns null if extraction fails or the MRZ is invalid.
 */
export async function extractMRZ(
  documentImage: ImageBitmap | HTMLCanvasElement
): Promise<MRZData | null> {
  if (!ocrWorker) throw new Error("OCR worker not initialized");

  const bitmap =
    documentImage instanceof ImageBitmap
      ? documentImage
      : await createImageBitmap(documentImage);
  const strip = await cropMRZStrip(bitmap);

  // Tesseract.js accepts OffscreenCanvas via blob conversion
  const blob = await (strip as unknown as OffscreenCanvas).convertToBlob();
  for (let attempt = 0; attempt < OCR.MAX_RETRIES; attempt++) {
    const { data } = await ocrWorker.recognize(blob);
    const lines = data.text
      .split("\n")
      .map((l) => l.trim().replace(/\s/g, ""))
      .filter((l) => l.length > 0);

    const mrzResult = tryParseMRZ(lines);
    if (mrzResult) return mrzResult;
  }

  return null;
}

/** Crops the lower ~15% of the document image, converts to grayscale, applies threshold. */
async function cropMRZStrip(source: ImageBitmap): Promise<OffscreenCanvas> {
  const { width, height } = source;
  const stripHeight = Math.round(height * 0.15);
  const y = height - stripHeight;

  const canvas = new OffscreenCanvas(width, stripHeight);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, y, width, stripHeight, 0, 0, width, stripHeight);

  // Grayscale + scale up for better OCR
  const imageData = ctx.getImageData(0, 0, width, stripHeight);
  applyGrayscaleOtsu(imageData);
  ctx.putImageData(imageData, 0, 0);

  // Scale up 2× for Tesseract accuracy
  const scaled = new OffscreenCanvas(width * 2, stripHeight * 2);
  const scaledCtx = scaled.getContext("2d")!;
  scaledCtx.imageSmoothingEnabled = false;
  scaledCtx.drawImage(canvas, 0, 0, width * 2, stripHeight * 2);

  return scaled;
}

/** In-place grayscale + Otsu binarization. */
function applyGrayscaleOtsu(imageData: ImageData): void {
  const d = imageData.data;
  const histogram = new Array(256).fill(0);

  for (let i = 0; i < d.length; i += 4) {
    const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = gray;
    histogram[gray]++;
  }

  const threshold = otsuThreshold(histogram, d.length / 4);

  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

function otsuThreshold(histogram: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0;
  let wB = 0;
  let max = 0;
  let threshold = 0;

  for (let i = 0; i < 256; i++) {
    wB += histogram[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += i * histogram[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;

    if (between > max) {
      max = between;
      threshold = i;
    }
  }
  return threshold;
}

function tryParseMRZ(lines: string[]): MRZData | null {
  try {
    // TD1 format: 3 lines of 30 chars (Argentine DNI)
    if (lines.length >= 3 && lines[0].length >= 30) {
      const result = parseMRZ([lines[0], lines[1], lines[2]]);
      if (result.valid) return formatMRZ(result);
    }
    // TD3 format: 2 lines of 44 chars (passport)
    if (lines.length >= 2 && lines[0].length >= 44) {
      const result = parseMRZ([lines[0], lines[1]]);
      if (result.valid) return formatMRZ(result);
    }
    return null;
  } catch {
    return null;
  }
}

function formatMRZ(parsed: ReturnType<typeof parseMRZ>): MRZData {
  return {
    surname: parsed.fields.lastName ?? "",
    firstName: parsed.fields.firstName ?? "",
    documentNumber: parsed.fields.documentNumber ?? "",
    birthDate: parsed.fields.birthDate ?? "",
    nationality: parsed.fields.nationality ?? "",
    sex: parsed.fields.sex ?? "",
    expirationDate: parsed.fields.expirationDate ?? "",
    valid: parsed.valid,
  };
}

export async function disposeOCR(): Promise<void> {
  await ocrWorker?.terminate();
  ocrWorker = null;
}
