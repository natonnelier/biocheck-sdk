import { DEFAULT_CONFIG, MINIFAS, LIVENESS } from "./config.js";
import { openCamera, captureFrameBitmap, closeCamera } from "./modules/capture.js";
import { cosineSimilarity } from "./utils/math.js";
import {
  detectBlink,
  getYawDegrees,
  getRelativeFaceWidth,
  buildChallengeSequence,
} from "./modules/liveness.js";
import { VisionWorkerClient } from "./workers/vision-client.js";
import { OCRWorkerClient } from "./workers/ocr-client.js";
import type {
  BiocheckConfig,
  VerifyResult,
  ProgressCallback,
  LivenessChallenge,
  FaceDetectionResult,
} from "./types.js";

export type {
  BiocheckConfig,
  VerifyResult,
  ProgressCallback,
  MRZData,
  LivenessChallenge,
  ProgressStep,
  FaceDetectionResult,
} from "./types.js";

/**
 * Runs the full identity verification pipeline entirely in the browser:
 *  1. Active liveness challenges (blink, head-turn, move-closer)
 *  2. Passive liveness sampling (MiniFASNetV2 over 3 frames)
 *  3. Document MRZ extraction (Tesseract.js OCR + mrz library)
 *  4. Document + selfie face alignment (5-point ArcFace, 112×112)
 *  5. Biometric comparison (SFace INT8 embeddings, cosine similarity)
 *
 * All model inference runs off the main thread inside dedicated Web Workers.
 *
 * @param videoElement - The <video> element already streaming the front camera.
 * @param documentImage - An ImageBitmap of the identity document (front side).
 * @param config - Optional configuration overrides.
 * @param onProgress - Optional callback called at each pipeline step.
 */
export async function verify(
  videoElement: HTMLVideoElement,
  documentImage: ImageBitmap,
  config?: BiocheckConfig,
  onProgress?: ProgressCallback
): Promise<VerifyResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const vision = new VisionWorkerClient();
  const ocr = new OCRWorkerClient();

  try {
    // ── 0. Initialise workers ────────────────────────────────────────────────
    onProgress?.("initializing");
    await Promise.all([
      vision.init(cfg.modelsBaseUrl),
      ocr.init(cfg.modelsBaseUrl),
    ]);

    // ── 1. Active liveness challenges ────────────────────────────────────────
    onProgress?.("liveness_challenge");
    const challenges = buildChallengeSequence(cfg.livenessChallengCount);
    for (const challenge of challenges) {
      const ok = await runSingleChallenge(
        videoElement,
        challenge,
        cfg.livenessChallengeDuration * 1000,
        vision
      );
      if (!ok) return { accepted: false, rejectedAt: "liveness" };
    }

    // ── 2. Passive liveness (3 frames sampled 100 ms apart) ──────────────────
    const passiveScore = await samplePassiveLiveness(
      videoElement,
      vision
    );
    if (passiveScore < cfg.livenessPassiveThreshold) {
      return { accepted: false, rejectedAt: "liveness" };
    }

    // ── 3. Document processing (OCR + face alignment run in parallel) ────────
    onProgress?.("capturing_document");
    onProgress?.("ocr");

    // Two copies of the document bitmap — one for OCR, one for face alignment.
    const [docBitmapForOCR, docBitmapForVision] = await Promise.all([
      createImageBitmap(documentImage),
      createImageBitmap(documentImage),
    ]);

    const [mrzData, docPhotoData] = await Promise.all([
      ocr.extractMRZ(docBitmapForOCR),
      (async () => {
        onProgress?.("extracting_document_photo");
        return vision.extractAlignedFace(docBitmapForVision);
      })(),
    ]);

    if (!mrzData) return { accepted: false, rejectedAt: "document_ocr" };
    if (!docPhotoData) return { accepted: false, rejectedAt: "document_photo" };

    // ── 4. Selfie face alignment ─────────────────────────────────────────────
    // Align the selfie to 112×112 exactly as the document photo so that both
    // embeddings are in the same canonical space for cosine comparison.
    onProgress?.("biometric_comparison");
    const selfieBitmap = await captureFrameBitmap(videoElement);
    const selfiePhotoData = await vision.extractAlignedFace(selfieBitmap);
    if (!selfiePhotoData) return { accepted: false, rejectedAt: "biometric_comparison" };

    // ── 5. Biometric comparison ───────────────────────────────────────────────
    const [docEmbedding, selfieEmbedding] = await Promise.all([
      vision.computeEmbedding(docPhotoData),
      vision.computeEmbedding(selfiePhotoData),
    ]);

    // Cosine similarity is computed inside the worker via compareFaces, but
    // the worker returns raw embeddings; comparison runs here so the score
    // stays on the main thread (never transmitted).
    const score = cosineSimilarity(docEmbedding, selfieEmbedding);
    const accepted = score >= cfg.threshold;

    onProgress?.("done");
    return { accepted, score };
  } finally {
    await Promise.all([vision.dispose(), ocr.dispose()]);
  }
}

/** Opens the front camera and returns the stream + a bound video element. */
export async function openCameraStream(): Promise<{
  stream: MediaStream;
  video: HTMLVideoElement;
}> {
  const stream = await openCamera();
  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  await video.play();
  return { stream, video };
}

export { closeCamera };

// ── Internal helpers ──────────────────────────────────────────────────────────

async function runSingleChallenge(
  video: HTMLVideoElement,
  challenge: LivenessChallenge,
  durationMs: number,
  vision: VisionWorkerClient
): Promise<boolean> {
  const deadline = Date.now() + durationMs;

  let blinkOpen = true;
  let headTurnPeak = false;
  let baseWidth: number | null = null;

  while (Date.now() < deadline) {
    const bitmap = await captureFrameBitmap(video);
    // detectFrame transfers the bitmap to the worker.
    const face: FaceDetectionResult = await vision.detectFrame(bitmap, Date.now());

    if (!face.hasFace) continue;

    let done = false;

    if (challenge === "blink") {
      const isBlinking = detectBlink(face);
      if (blinkOpen && isBlinking) blinkOpen = false;
      else if (!blinkOpen && !isBlinking) done = true;
    } else if (challenge === "turn_head") {
      const yaw = Math.abs(getYawDegrees(face));
      if (!headTurnPeak && yaw > LIVENESS.HEAD_TURN_DEGREES) headTurnPeak = true;
      else if (headTurnPeak && yaw < LIVENESS.HEAD_RETURN_DEGREES) done = true;
    } else if (challenge === "move_closer") {
      const w = getRelativeFaceWidth(face);
      if (baseWidth === null) baseWidth = w;
      else if (w >= baseWidth * LIVENESS.MOVE_CLOSER_RATIO) done = true;
    }

    if (done) return true;
  }
  return false;
}

async function samplePassiveLiveness(
  video: HTMLVideoElement,
  vision: VisionWorkerClient
): Promise<number> {
  const scores: number[] = [];
  for (let i = 0; i < MINIFAS.FRAMES_TO_ANALYZE; i++) {
    const bitmap = await captureFrameBitmap(video);
    // scorePassiveLiveness transfers the bitmap; the worker crops to 80×80.
    scores.push(await vision.scorePassiveLiveness(bitmap));
    if (i < MINIFAS.FRAMES_TO_ANALYZE - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

