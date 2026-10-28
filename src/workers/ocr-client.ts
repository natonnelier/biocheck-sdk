import type { MRZData } from "../types.js";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * Main-thread proxy for the OCR Worker.
 * Each method maps to a postMessage call and returns a typed Promise.
 */
export class OCRWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;

  constructor() {
    this.worker = new Worker(
      new URL("./ocr.worker.ts", import.meta.url)
      // No { type: 'module' } → classic worker
    );
    this.worker.addEventListener("message", (event) => {
      const { id, result, error } = event.data as {
        id: number;
        result?: unknown;
        error?: string;
      };
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      error !== undefined ? p.reject(new Error(error)) : p.resolve(result);
    });
    this.worker.addEventListener("error", (event) => {
      const err = new Error(`OCR worker error: ${event.message}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  private call(
    type: string,
    args: Record<string, unknown>,
    transfer: Transferable[] = []
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...args }, transfer);
    });
  }

  /** Initialises the Tesseract.js worker inside the OCR worker. */
  init(modelsBaseUrl: string): Promise<void> {
    return this.call("init", { modelsBaseUrl }) as Promise<void>;
  }

  /**
   * Extracts the MRZ from a document ImageBitmap.
   * The ImageBitmap is transferred to the worker.
   */
  extractMRZ(imageBitmap: ImageBitmap): Promise<MRZData | null> {
    return this.call(
      "extractMRZ",
      { imageBitmap },
      [imageBitmap]
    ) as Promise<MRZData | null>;
  }

  /** Disposes the Tesseract worker and terminates the OCR worker. */
  async dispose(): Promise<void> {
    await this.call("dispose", {});
    this.worker.terminate();
  }
}
