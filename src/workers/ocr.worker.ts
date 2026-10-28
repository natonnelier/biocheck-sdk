/**
 * OCR Worker — classic Worker running Tesseract.js off the main thread.
 * Tesseract.js itself spawns a further internal worker, so the hierarchy is:
 *   Main thread → OCR Worker → Tesseract internal worker
 *
 * Message protocol: { id, type, ...args } → { id, result } | { id, error }
 */

import { initOCR, extractMRZ, disposeOCR } from "../modules/ocr.js";

self.addEventListener("message", async (event: MessageEvent) => {
  const { id, type, ...args } = event.data as {
    id: number;
    type: string;
    [key: string]: unknown;
  };

  try {
    let result: unknown;

    switch (type) {
      case "init": {
        await initOCR(args.modelsBaseUrl as string);
        result = null;
        break;
      }

      case "extractMRZ": {
        result = await extractMRZ(args.imageBitmap as ImageBitmap);
        break;
      }

      case "dispose": {
        await disposeOCR();
        result = null;
        break;
      }

      default:
        throw new Error(`Unknown OCR worker message type: ${type}`);
    }

    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: (e as Error).message });
  }
});
