/**
 * Every configurable parameter of table 3.6 (thesis 3.4.3), grouped by module.
 * All numeric values are initial design values; calibration happens in Ch. 4.
 */
export interface ResolvedConfig {
  /** Base URL where `manifest.json` and the hashed model files are served. */
  modelsBaseUrl: string;
  camera: {
    /** Minimum capture resolution, in pixels. */
    minWidth: number;
    minHeight: number;
    /** Minimum camera frame rate, in frames per second. */
    minFrameRate: number;
  };
  detection: {
    /** Minimum face-detection confidence (Face Landmarker). */
    minConfidence: number;
    /** Minimum face-box width, as a fraction of the frame width. */
    minFaceWidthRatio: number;
  };
  liveness: {
    /** Number of active challenges (1–3). */
    challengeCount: number;
    /** Timeout of every state, including waiting for a face, in seconds. */
    timeoutSeconds: number;
    /** Blink blendshape score above which the eyes count as closed. */
    blinkClosedThreshold: number;
    /** Blink blendshape score below which the eyes count as open. */
    blinkOpenThreshold: number;
    /** Consecutive processed frames with closed eyes needed for a blink. */
    blinkClosedFrames: number;
    /** Yaw the head must exceed towards the requested side, in degrees. */
    turnDegrees: number;
    /** Yaw the head must return within, in degrees. */
    returnDegrees: number;
    /** Minimum face-width increase for "move closer" (0.3 = +30 %). */
    widthIncrease: number;
    /** Minimum nose/face perspective-ratio increase (0.05 = +5 %). */
    perspectiveIncrease: number;
    /** Valid frames evaluated by MiniFASNetV2. */
    passiveFrames: number;
    /** Minimum mean real-class probability. */
    passiveThreshold: number;
  };
  document: {
    /** Target MRZ character height range after upscaling, in pixels. */
    mrzCharHeightMin: number;
    mrzCharHeightMax: number;
    /** Minimum width of the holder's photo, in pixels. */
    photoMinWidth: number;
    /** Maximum captures per required image. */
    maxCaptures: number;
  };
  comparison: {
    /** Maximum |yaw| and |pitch| of the selfie frame, in degrees. */
    maxAngleDegrees: number;
  };
  decision: {
    /** Decision threshold τ on score = max(0, cos). */
    threshold: number;
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

/** Caller-supplied overrides; anything omitted takes its default. */
export type BiocheckConfig = DeepPartial<ResolvedConfig>;

/**
 * The only data the SDK ever returns. `score` is present only when the
 * biometric comparison was reached. Embeddings, images and document data
 * never leave the face worker.
 */
export interface VerifyResult {
  accepted: boolean;
  score?: number;
}

/**
 * Failures that prevent a verification from completing. These reject the
 * promise returned by `verify` with a `BiocheckError`; they are not decisions.
 */
export type BiocheckErrorCode =
  | "browser_not_supported"
  | "camera_permission_denied"
  | "camera_unavailable"
  | "model_load_failed"
  | "invalid_config"
  | "internal_error";

export type DocumentType = "dni" | "passport";
