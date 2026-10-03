export interface BiocheckConfig {
  /** Cosine similarity threshold for face match. Default: 0.363 */
  threshold?: number;
  /** Base URL where model files are served. Default: "/models" */
  modelsBaseUrl?: string;
  /** Number of liveness challenges. Default: 3 */
  livenessChallengCount?: number;
  /** Seconds allowed per challenge. Default: 5 */
  livenessChallengeDuration?: number;
  /** MiniFASNetV2 passive liveness threshold. Default: 0.5 */
  livenessPassiveThreshold?: number;
}

export interface VerifyResult {
  /** Whether the identity was accepted */
  accepted: boolean;
  /**
   * Cosine similarity score (0–1) between document photo and selfie.
   * Only present if the pipeline reached the biometric comparison step.
   */
  score?: number;
  /** Stage at which a rejection occurred, if applicable */
  rejectedAt?: RejectionStage;
}

export type RejectionStage =
  | "liveness"
  | "document_ocr"
  | "document_photo"
  | "biometric_comparison";

export type LivenessChallenge = "blink" | "turn_head" | "move_closer";

export interface MRZData {
  surname: string;
  firstName: string;
  documentNumber: string;
  birthDate: string;
  nationality: string;
  sex: string;
  expirationDate: string;
  valid: boolean;
}

export type ProgressStep =
  | "initializing"
  | "liveness_challenge"
  | "capturing_document"
  | "ocr"
  | "extracting_document_photo"
  | "biometric_comparison"
  | "done";

export type ProgressCallback = (step: ProgressStep) => void;
