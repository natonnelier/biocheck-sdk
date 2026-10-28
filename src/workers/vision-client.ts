import type { FaceDetectionResult } from "../types.js";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * Main-thread proxy for the Vision Worker.
 * Each method maps to a postMessage call and returns a typed Promise.
 */
export class VisionWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;

  constructor() {
    this.worker = new Worker(
      new URL("./vision.worker.ts", import.meta.url)
      // No { type: 'module' } → classic worker (required for MediaPipe)
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
      const err = new Error(`Vision worker error: ${event.message}`);
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

  /** Initialises all vision models inside the worker. */
  init(modelsBaseUrl: string): Promise<void> {
    return this.call("init", { modelsBaseUrl }) as Promise<void>;
  }

  /**
   * Runs face landmarking on a video frame (VIDEO mode).
   * The ImageBitmap is transferred to the worker; the caller must not use it
   * afterwards.
   */
  detectFrame(imageBitmap: ImageBitmap, timestampMs: number): Promise<FaceDetectionResult> {
    return this.call(
      "detectFrame",
      { imageBitmap, timestampMs },
      [imageBitmap]
    ) as Promise<FaceDetectionResult>;
  }

  /**
   * Scores a single frame for passive liveness via MiniFASNetV2.
   * The ImageBitmap is transferred; the worker crops it to 80×80 internally.
   */
  scorePassiveLiveness(imageBitmap: ImageBitmap): Promise<number> {
    return this.call(
      "scorePassiveLiveness",
      { imageBitmap },
      [imageBitmap]
    ) as Promise<number>;
  }

  /**
   * Detects the largest face in an image and returns a 112×112 aligned crop
   * (ArcFace 5-point alignment). Returns null if no valid face is found.
   * Used for both the document photo and the selfie.
   * The ImageBitmap is transferred to the worker.
   */
  extractAlignedFace(imageBitmap: ImageBitmap): Promise<ImageData | null> {
    return this.call(
      "extractAlignedFace",
      { imageBitmap },
      [imageBitmap]
    ) as Promise<ImageData | null>;
  }

  /**
   * Computes a 128-d SFace embedding from a 112×112 aligned face ImageData.
   * The ImageData is structured-cloned (50 KB) — acceptable for this size.
   */
  computeEmbedding(imageData: ImageData): Promise<Float32Array> {
    return this.call("computeEmbedding", { imageData }) as Promise<Float32Array>;
  }

  /** Disposes all models and terminates the worker. */
  async dispose(): Promise<void> {
    await this.call("dispose", {});
    this.worker.terminate();
  }
}
