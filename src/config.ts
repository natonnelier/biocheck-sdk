import type { BiocheckConfig } from "./types.js";

export const DEFAULT_CONFIG: Required<BiocheckConfig> = {
  threshold: 0.363,
  modelsBaseUrl: "/models",
  livenessChallengCount: 3,
  livenessChallengeDuration: 5,
  livenessPassiveThreshold: 0.5,
};

/** Liveness active challenge thresholds */
export const LIVENESS = {
  /** EAR below this → eye considered closed */
  EAR_CLOSED: 0.3,
  /** EAR above this → eye considered open */
  EAR_OPEN: 0.5,
  /** Yaw angle (degrees) to trigger head turn */
  HEAD_TURN_DEGREES: 20,
  /** Yaw angle (degrees) to consider head returned */
  HEAD_RETURN_DEGREES: 10,
  /** Relative face width increase to detect "move closer" */
  MOVE_CLOSER_RATIO: 1.3,
  /** Nose/face perspective ratio increase (move closer challenge) */
  PERSPECTIVE_RATIO_INCREASE: 0.05,
} as const;

/** SFace model details */
export const SFACE = {
  EMBEDDING_DIM: 128,
  INPUT_SIZE: 112,
  MODEL_FILE: "sface_int8.onnx",
} as const;

/** MiniFASNetV2 model details */
export const MINIFAS = {
  MODEL_FILE: "minifasnetv2.onnx",
  /** Index of the "real face" class in softmax output */
  REAL_CLASS_INDEX: 1,
  FRAMES_TO_ANALYZE: 3,
} as const;

/** Face Landmarker model */
export const FACE_LANDMARKER = {
  MODEL_FILE: "face_landmarker.task",
  NUM_FACES: 1,
  MIN_DETECTION_CONFIDENCE: 0.5,
  MIN_TRACKING_CONFIDENCE: 0.5,
} as const;

/** Tesseract OCR */
export const OCR = {
  MODEL_FILE: "ocrb_int.traineddata",
  WHITELIST: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
  MAX_RETRIES: 3,
} as const;

/** Document photo extraction */
export const DOCUMENT_PHOTO = {
  /** Minimum face width in pixels after extraction */
  MIN_FACE_WIDTH_PX: 112,
  /** Output size for aligned face crop */
  ALIGNED_SIZE: 112,
} as const;
