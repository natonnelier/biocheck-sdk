import * as ort from "onnxruntime-web";
import { SFACE } from "../config.js";
import { cosineSimilarity } from "../utils/math.js";

let sfaceSession: ort.InferenceSession | null = null;

export async function initRecognition(modelsBaseUrl: string): Promise<void> {
  sfaceSession = await ort.InferenceSession.create(
    `${modelsBaseUrl}/${SFACE.MODEL_FILE}`,
    { executionProviders: ["wasm"] }
  );
}

/**
 * Computes a 128-d embedding from a 112×112 aligned face crop.
 * Input: ImageData (RGBA, 112×112).
 */
export async function computeEmbedding(alignedFace: ImageData): Promise<Float32Array> {
  if (!sfaceSession) throw new Error("Recognition model not initialized");

  const input = preprocessSFace(alignedFace);
  const tensor = new ort.Tensor("float32", input, [1, 3, SFACE.INPUT_SIZE, SFACE.INPUT_SIZE]);
  const feeds = { data: tensor };
  const output = await sfaceSession.run(feeds);
  return output[Object.keys(output)[0]].data as Float32Array;
}

/**
 * Compares two face embeddings and returns a cosine similarity score in [0, 1].
 */
export function compareFaces(embA: Float32Array, embB: Float32Array): number {
  return cosineSimilarity(embA, embB);
}

/** Preprocesses RGBA ImageData to CHW float32 normalized to [-1, 1] (SFace convention). */
function preprocessSFace(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const n = width * height;
  const tensor = new Float32Array(3 * n);

  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    // Normalize to [-1, 1]
    tensor[i] = (r - 0.5) / 0.5;
    tensor[n + i] = (g - 0.5) / 0.5;
    tensor[2 * n + i] = (b - 0.5) / 0.5;
  }
  return tensor;
}

export function disposeRecognition(): void {
  sfaceSession = null;
}
