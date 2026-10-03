import * as ort from "onnxruntime-web";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { LIVENESS, MINIFAS } from "../config.js";
import type { LivenessChallenge } from "../types.js";

// Blendshape indices for eye blink (MediaPipe 52-blendshape model)
const BLINK_LEFT_INDEX = 9;   // eyeBlinkLeft
const BLINK_RIGHT_INDEX = 10; // eyeBlinkRight

let fasSession: ort.InferenceSession | null = null;

export async function initPassiveLiveness(modelsBaseUrl: string): Promise<void> {
  fasSession = await ort.InferenceSession.create(
    `${modelsBaseUrl}/${MINIFAS.MODEL_FILE}`,
    { executionProviders: ["wasm"] }
  );
}

/** Returns true if the landmark result indicates a blink. */
export function detectBlink(result: FaceLandmarkerResult): boolean {
  const blendshapes = result.faceBlendshapes?.[0]?.categories;
  if (!blendshapes) return false;
  const left = blendshapes[BLINK_LEFT_INDEX]?.score ?? 0;
  const right = blendshapes[BLINK_RIGHT_INDEX]?.score ?? 0;
  return left > LIVENESS.EAR_CLOSED && right > LIVENESS.EAR_CLOSED;
}

/** Returns yaw angle in degrees from the facial transformation matrix. */
export function getYawDegrees(result: FaceLandmarkerResult): number {
  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  if (!matrix) return 0;
  // Row-major 4×4 matrix: yaw extracted from rotation submatrix
  const sinYaw = -matrix[8];
  return (Math.asin(Math.min(1, Math.max(-1, sinYaw))) * 180) / Math.PI;
}

/** Returns normalized face width (relative to frame width) from landmarks. */
export function getRelativeFaceWidth(result: FaceLandmarkerResult): number {
  const lms = result.faceLandmarks?.[0];
  if (!lms) return 0;
  const xs = lms.map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

/**
 * Scores a single frame with MiniFASNetV2.
 * Returns the probability of the face being real (class index 1).
 * Input: 80×80 RGB ImageData cropped to the face region.
 */
export async function scorePassiveLiveness(
  faceCrop: ImageData
): Promise<number> {
  if (!fasSession) throw new Error("Passive liveness model not initialized");

  const input = preprocessForFAS(faceCrop);
  const feeds = { input: new ort.Tensor("float32", input, [1, 3, 80, 80]) };
  const output = await fasSession.run(feeds);
  const scores = output[Object.keys(output)[0]].data as Float32Array;

  // Softmax then pick real-class index
  const expScores = Array.from(scores).map(Math.exp);
  const sum = expScores.reduce((a, b) => a + b, 0);
  return expScores[MINIFAS.REAL_CLASS_INDEX] / sum;
}

/** Preprocesses an 80×80 ImageData to CHW float32 tensor (BGR channel order). */
function preprocessForFAS(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const tensor = new Float32Array(3 * width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // BGR channel order, normalized to [0, 1]
    tensor[i] = b / 255;
    tensor[width * height + i] = g / 255;
    tensor[2 * width * height + i] = r / 255;
  }
  return tensor;
}

export function disposeLiveness(): void {
  fasSession = null;
}

/** Selects a random ordered set of liveness challenges. */
export function buildChallengeSequence(count: number): LivenessChallenge[] {
  const pool: LivenessChallenge[] = ["blink", "turn_head", "move_closer"];
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, pool.length));
}
