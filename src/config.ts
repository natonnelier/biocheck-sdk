import { BiocheckError } from "./errors.js";
import type { BiocheckConfig, ResolvedConfig } from "./types.js";

/** Initial design values of table 3.6. */
export const DEFAULT_CONFIG: ResolvedConfig = {
  modelsBaseUrl: "/models",
  camera: { minWidth: 640, minHeight: 480, minFrameRate: 15 },
  detection: { minConfidence: 0.8, minFaceWidthRatio: 0.25 },
  liveness: {
    challengeCount: 3,
    timeoutSeconds: 5,
    blinkClosedThreshold: 0.5,
    blinkOpenThreshold: 0.3,
    blinkClosedFrames: 2,
    turnDegrees: 20,
    returnDegrees: 10,
    widthIncrease: 0.3,
    perspectiveIncrease: 0.05,
    passiveFrames: 3,
    passiveThreshold: 0.5,
  },
  document: {
    mrzCharHeightMin: 30,
    mrzCharHeightMax: 40,
    photoMinWidth: 112,
    maxCaptures: 3,
  },
  comparison: { maxAngleDegrees: 15 },
  decision: { threshold: 0.363 },
};

/** Merges caller overrides into the defaults and validates the result. */
export function resolveConfig(overrides: BiocheckConfig = {}): ResolvedConfig {
  const cfg: ResolvedConfig = {
    modelsBaseUrl: (overrides.modelsBaseUrl ?? DEFAULT_CONFIG.modelsBaseUrl).replace(/\/$/, ""),
    camera: { ...DEFAULT_CONFIG.camera, ...overrides.camera },
    detection: { ...DEFAULT_CONFIG.detection, ...overrides.detection },
    liveness: { ...DEFAULT_CONFIG.liveness, ...overrides.liveness },
    document: { ...DEFAULT_CONFIG.document, ...overrides.document },
    comparison: { ...DEFAULT_CONFIG.comparison, ...overrides.comparison },
    decision: { ...DEFAULT_CONFIG.decision, ...overrides.decision },
  };
  const l = cfg.liveness;
  const d = cfg.document;
  const problems = [
    !(Number.isInteger(l.challengeCount) && l.challengeCount >= 1 && l.challengeCount <= 3) &&
      "liveness.challengeCount must be an integer in 1–3",
    !(Number.isInteger(l.passiveFrames) && l.passiveFrames >= 1) &&
      "liveness.passiveFrames must be a positive integer",
    !(Number.isInteger(l.blinkClosedFrames) && l.blinkClosedFrames >= 1) &&
      "liveness.blinkClosedFrames must be a positive integer",
    !(l.blinkOpenThreshold < l.blinkClosedThreshold) &&
      "liveness.blinkOpenThreshold must be below blinkClosedThreshold",
    !(l.returnDegrees < l.turnDegrees) && "liveness.returnDegrees must be below turnDegrees",
    !(Number.isInteger(d.maxCaptures) && d.maxCaptures >= 1) &&
      "document.maxCaptures must be a positive integer",
    !(d.mrzCharHeightMin > 0 && d.mrzCharHeightMin <= d.mrzCharHeightMax) &&
      "document.mrzCharHeightMin must be positive and ≤ mrzCharHeightMax",
  ].filter((p): p is string => typeof p === "string");
  if (problems.length) throw new BiocheckError("invalid_config", problems.join("; "));
  return cfg;
}

// ── Fixed constants (not calibratable) ─────────────────────────────────────

/** Logical model/runtime file ids, resolved through manifest.json. */
export const MODEL_IDS = {
  faceLandmarker: "face_landmarker",
  sface: "sface",
  minifasnet: "minifasnetv2",
  ocrb: "ocrb",
  mediapipeLoader: "mediapipe_wasm_loader",
  mediapipeBinary: "mediapipe_wasm_binary",
  ortGlue: "ort_wasm_glue",
  ortBinary: "ort_wasm_binary",
  tesseractWorker: "tesseract_worker",
  tesseractCore: "tesseract_core",
} as const;

export type ModelId = (typeof MODEL_IDS)[keyof typeof MODEL_IDS];

export const SFACE = {
  INPUT_SIZE: 112,
} as const;

export const MINIFAS = {
  INPUT_SIZE: 80,
  /** Crop scale, from the weight-file prefix `2.7_80x80_MiniFASNetV2`. */
  CROP_SCALE: 2.7,
  /** Class 0 = spoof (print), 1 = real, 2 = spoof (replay); per Minivision test.py. */
  REAL_CLASS_INDEX: 1,
} as const;

export const FACE_LANDMARKER = {
  /** ≥ 2 so that a second face in a selfie frame can be detected and rejected. */
  VIDEO_NUM_FACES: 2,
  /** Polycarbonate DNI: main photo + ghost image + laser image. */
  IMAGE_NUM_FACES: 3,
} as const;

/** The MRZ uses only these characters (ICAO 9303). */
export const MRZ_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

/**
 * Physical layout used to crop the MRZ strip and estimate the character
 * height from it. Heights in millimetres (ICAO 9303 parts 4 and 5).
 *  - DNI: ID-1 card, 85.6 × 54 mm, TD1 (3 × 30).
 *  - Passport: TD3 data page, 125 × 88 mm, TD3 (2 × 44).
 * `stripMm` is the bottom band cropped; it holds the MRZ plus framing slack.
 */
export const DOCUMENT_LAYOUT = {
  dni: { aspect: 85.6 / 54, heightMm: 54, stripMm: 19, lines: 3, lineLength: 30 },
  passport: { aspect: 125 / 88, heightMm: 88, stripMm: 20, lines: 2, lineLength: 44 },
} as const;

/** OCR-B size 1 character height (ICAO 9303-3), in millimetres. */
export const MRZ_CHAR_HEIGHT_MM = 2.4;
