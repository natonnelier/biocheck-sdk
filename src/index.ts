import { DEFAULT_CONFIG, MINIFAS } from "./config.js";
import { openCamera, captureFrame, closeCamera } from "./modules/capture.js";
import { initFaceLandmarker, detectFace, disposeFaceLandmarker } from "./modules/detection.js";
import {
  initPassiveLiveness,
  detectBlink,
  getYawDegrees,
  getRelativeFaceWidth,
  scorePassiveLiveness,
  buildChallengeSequence,
  disposeLiveness,
} from "./modules/liveness.js";
import { initOCR, extractMRZ, disposeOCR } from "./modules/ocr.js";
import { extractDocumentPhoto } from "./modules/document.js";
import { initRecognition, computeEmbedding, compareFaces, disposeRecognition } from "./modules/recognition.js";
import { LIVENESS } from "./config.js";
import type {
  BiocheckConfig,
  VerifyResult,
  ProgressCallback,
  LivenessChallenge,
} from "./types.js";

export type { BiocheckConfig, VerifyResult, ProgressCallback, MRZData, LivenessChallenge, ProgressStep } from "./types.js";

/**
 * Runs the full identity verification pipeline:
 *  1. Liveness check (active challenges + passive MiniFASNetV2)
 *  2. Document capture → OCR (MRZ) + photo extraction
 *  3. Biometric comparison (SFace embeddings, cosine similarity)
 *
 * @param videoElement - The <video> element already streaming the front camera.
 * @param documentImage - An ImageBitmap of the identity document (front side).
 * @param config - Optional configuration overrides.
 * @param onProgress - Optional callback called at each pipeline step.
 * @returns VerifyResult with accepted flag and optional similarity score.
 */
export async function verify(
  videoElement: HTMLVideoElement,
  documentImage: ImageBitmap,
  config?: BiocheckConfig,
  onProgress?: ProgressCallback
): Promise<VerifyResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  onProgress?.("initializing");
  await Promise.all([
    initFaceLandmarker(cfg.modelsBaseUrl),
    initPassiveLiveness(cfg.modelsBaseUrl),
    initRecognition(cfg.modelsBaseUrl),
    initOCR(cfg.modelsBaseUrl),
  ]);

  try {
    // ── 1. Active liveness challenges ─────────────────────────────────────
    onProgress?.("liveness_challenge");
    const challenges = buildChallengeSequence(cfg.livenessChallengCount);
    const livenessOk = await runLivenessChallenges(
      videoElement,
      challenges,
      cfg.livenessChallengeDuration * 1000
    );
    if (!livenessOk) return { accepted: false, rejectedAt: "liveness" };

    // Passive liveness on 3 sampled frames
    const passiveScore = await samplePassiveLiveness(videoElement);
    if (passiveScore < cfg.livenessPassiveThreshold) {
      return { accepted: false, rejectedAt: "liveness" };
    }

    // ── 2. Document OCR ────────────────────────────────────────────────────
    onProgress?.("capturing_document");
    onProgress?.("ocr");
    const mrzData = await extractMRZ(documentImage);
    if (!mrzData) return { accepted: false, rejectedAt: "document_ocr" };

    // ── 3. Document photo extraction ───────────────────────────────────────
    onProgress?.("extracting_document_photo");
    const docPhotoData = await extractDocumentPhoto(documentImage);
    if (!docPhotoData) return { accepted: false, rejectedAt: "document_photo" };

    // ── 4. Selfie capture + biometric comparison ───────────────────────────
    onProgress?.("biometric_comparison");
    const selfieFrame = captureFrame(videoElement);
    const [docEmbedding, selfieEmbedding] = await Promise.all([
      computeEmbedding(docPhotoData),
      computeEmbedding(selfieFrame),
    ]);

    const score = compareFaces(docEmbedding, selfieEmbedding);
    const accepted = score >= cfg.threshold;

    onProgress?.("done");
    return { accepted, score };
  } finally {
    disposeFaceLandmarker();
    disposeLiveness();
    disposeRecognition();
    await disposeOCR();
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

async function runLivenessChallenges(
  video: HTMLVideoElement,
  challenges: LivenessChallenge[],
  durationMs: number
): Promise<boolean> {
  for (const challenge of challenges) {
    const ok = await runSingleChallenge(video, challenge, durationMs);
    if (!ok) return false;
  }
  return true;
}

async function runSingleChallenge(
  video: HTMLVideoElement,
  challenge: LivenessChallenge,
  durationMs: number
): Promise<boolean> {
  const deadline = Date.now() + durationMs;

  // Challenge state machine
  let blinkOpen = true;
  let headTurnPeak = false;
  let baseWidth: number | null = null;

  return new Promise<boolean>((resolve) => {
    let animFrame: number;

    const tick = () => {
      if (Date.now() > deadline) {
        cancelAnimationFrame(animFrame);
        resolve(false);
        return;
      }

      const result = detectFace(video, Date.now());
      if (!result.faceLandmarks?.length) {
        animFrame = requestAnimationFrame(tick);
        return;
      }

      let done = false;

      if (challenge === "blink") {
        const isBlinking = detectBlink(result);
        if (blinkOpen && isBlinking) blinkOpen = false;
        else if (!blinkOpen && !isBlinking) done = true;
      } else if (challenge === "turn_head") {
        const yaw = Math.abs(getYawDegrees(result));
        if (!headTurnPeak && yaw > LIVENESS.HEAD_TURN_DEGREES) headTurnPeak = true;
        else if (headTurnPeak && yaw < LIVENESS.HEAD_RETURN_DEGREES) done = true;
      } else if (challenge === "move_closer") {
        const w = getRelativeFaceWidth(result);
        if (baseWidth === null) baseWidth = w;
        else if (w >= baseWidth * LIVENESS.MOVE_CLOSER_RATIO) done = true;
      }

      if (done) {
        cancelAnimationFrame(animFrame);
        resolve(true);
      } else {
        animFrame = requestAnimationFrame(tick);
      }
    };

    animFrame = requestAnimationFrame(tick);
  });
}

async function samplePassiveLiveness(video: HTMLVideoElement): Promise<number> {
  const scores: number[] = [];
  for (let i = 0; i < MINIFAS.FRAMES_TO_ANALYZE; i++) {
    const frame = captureFrame(video);
    // Crop to an 80×80 center region for MiniFASNetV2
    const crop = cropCenter80(frame);
    const score = await scorePassiveLiveness(crop);
    scores.push(score);
    if (i < MINIFAS.FRAMES_TO_ANALYZE - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function cropCenter80(imageData: ImageData): ImageData {
  const { width, height } = imageData;
  const size = 80;
  const x0 = Math.max(0, Math.floor((width - size) / 2));
  const y0 = Math.max(0, Math.floor((height - size) / 2));

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  const tmpCanvas = new OffscreenCanvas(width, height);
  tmpCanvas.getContext("2d")!.putImageData(imageData, 0, 0);
  ctx.drawImage(tmpCanvas, x0, y0, size, size, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}
