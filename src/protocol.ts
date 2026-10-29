/**
 * Message protocol between the main thread and the face worker (thesis 3.3.2,
 * table 3.3). Both ends import these types, so any mismatch between a sent
 * and an expected message is a compile error.
 *
 * Privacy rule: no worker → main message carries images, landmarks, matrices
 * or embeddings. Only UI state and the final decision/score cross back.
 */
import type { ResolvedConfig } from "./types.js";

export type ChallengeKind = "blink" | "turn" | "move_closer";
/** Side relative to the user (as seen in the mirrored preview). */
export type TurnSide = "left" | "right";

export interface Challenge {
  kind: ChallengeKind;
  /** Only for `turn`. */
  side?: TurnSide;
}

/** Why the current frame is not valid (thesis 3.2.2). */
export type FrameHint = "no_face" | "multiple_faces" | "face_too_small";

export type LivenessState = "waiting_face" | "challenge" | "processing";

export interface WorkerModelUrls {
  faceLandmarker: string;
  sface: string;
  minifasnet: string;
  mediapipeLoader: string;
  mediapipeBinary: string;
  ortGlue: string;
  ortBinary: string;
}

export type WorkerConfig = Pick<ResolvedConfig, "detection" | "liveness" | "comparison" | "decision"> & {
  photoMinWidth: number;
};

// ── Main thread → worker ─────────────────────────────────────────────────

export type ToWorker =
  | { type: "init"; config: WorkerConfig; urls: WorkerModelUrls }
  /** Front of the DNI or passport data page; the bitmap is transferred. */
  | { type: "document-photo"; bitmap: ImageBitmap }
  | { type: "liveness-start" }
  /** One camera frame (original orientation); the bitmap is transferred. */
  | { type: "frame"; bitmap: ImageBitmap; timestamp: number };

// ── Worker → main thread ─────────────────────────────────────────────────

export type OrtBackend = "wasm" | "webgpu";
export type MediaPipeDelegate = "GPU" | "CPU";

export type FromWorker =
  | { type: "ready"; backends: { onnxruntime: OrtBackend; mediapipe: MediaPipeDelegate } }
  | { type: "document-result"; valid: boolean }
  | {
      type: "state";
      state: LivenessState;
      /** Current challenge, while `state === "challenge"`. */
      challenge?: Challenge;
      /** 0-based index of the current challenge and total count. */
      challengeIndex?: number;
      challengeTotal?: number;
      hint?: FrameHint;
    }
  | { type: "result"; accepted: boolean; score?: number }
  | { type: "error"; code: "model_load_failed" | "internal_error"; message: string };

/** Typed postMessage for the worker side. */
export function postToMain(msg: FromWorker): void {
  (self as unknown as { postMessage(m: FromWorker): void }).postMessage(msg);
}
