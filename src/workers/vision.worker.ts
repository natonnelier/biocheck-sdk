/**
 * Vision Worker — classic Worker running MediaPipe Face Landmarker and
 * ONNX Runtime (SFace + MiniFASNetV2) off the main thread.
 *
 * Message protocol: { id, type, ...args } → { id, result } | { id, error }
 *
 * MediaPipe requires a classic (non-module) worker because its WASM wrapper
 * may call importScripts internally. Vite compiles this to IIFE format so
 * that it can be loaded without { type: 'module' }.
 */

import {
  initFaceLandmarker,
  detectFace,
  disposeFaceLandmarker,
} from "../modules/detection.js";
import {
  initPassiveLiveness,
  scorePassiveLiveness,
  disposeLiveness,
} from "../modules/liveness.js";
import {
  initRecognition,
  computeEmbedding,
  disposeRecognition,
} from "../modules/recognition.js";
import { extractDocumentPhoto } from "../modules/document.js";
import type { FaceDetectionResult } from "../types.js";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Crops the center 80×80 region of an ImageBitmap for MiniFASNetV2.
 * Returns an ImageData ready for passive-liveness inference.
 */
function cropCenter80FromBitmap(bitmap: ImageBitmap): ImageData {
  const { width, height } = bitmap;
  const size = 80;
  const x0 = Math.max(0, Math.floor((width - size) / 2));
  const y0 = Math.max(0, Math.floor((height - size) / 2));
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext("2d")!.drawImage(bitmap, x0, y0, size, size, 0, 0, size, size);
  return canvas.getContext("2d")!.getImageData(0, 0, size, size);
}

/**
 * Extracts a plain-object representation of the landmark result so that no
 * WASM-heap references cross the worker boundary via postMessage.
 */
function serializeFaceResult(result: FaceLandmarkerResult): FaceDetectionResult {
  const hasFace = (result.faceLandmarks?.length ?? 0) > 0;
  if (!hasFace) {
    return { hasFace: false, landmarks: [], blendshapeScores: [], transformMatrix: [] };
  }
  const landmarks = result.faceLandmarks[0].map((lm) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z,
  }));
  const blendshapeScores = (result.faceBlendshapes?.[0]?.categories ?? []).map(
    (c) => c.score
  );
  const rawMatrix = result.facialTransformationMatrixes?.[0]?.data;
  const transformMatrix = rawMatrix ? Array.from(rawMatrix) : [];
  return { hasFace, landmarks, blendshapeScores, transformMatrix };
}

// ── Message handler ────────────────────────────────────────────────────────────

self.addEventListener("message", async (event: MessageEvent) => {
  const { id, type, ...args } = event.data as {
    id: number;
    type: string;
    [key: string]: unknown;
  };

  try {
    let result: unknown;

    switch (type) {
      case "init": {
        await Promise.all([
          initFaceLandmarker(args.modelsBaseUrl as string),
          initPassiveLiveness(args.modelsBaseUrl as string),
          initRecognition(args.modelsBaseUrl as string),
        ]);
        result = null;
        break;
      }

      case "detectFrame": {
        const bitmap = args.imageBitmap as ImageBitmap;
        const ts = args.timestampMs as number;
        const faceResult = detectFace(bitmap, ts);
        bitmap.close();
        result = serializeFaceResult(faceResult);
        break;
      }

      case "scorePassiveLiveness": {
        const bitmap = args.imageBitmap as ImageBitmap;
        const crop = cropCenter80FromBitmap(bitmap);
        bitmap.close();
        result = await scorePassiveLiveness(crop);
        break;
      }

      case "extractAlignedFace": {
        const bitmap = args.imageBitmap as ImageBitmap;
        result = await extractDocumentPhoto(bitmap);
        // bitmap may be closed by extractDocumentPhoto internally via detectFaceInImage
        break;
      }

      case "computeEmbedding": {
        result = await computeEmbedding(args.imageData as ImageData);
        break;
      }

      case "dispose": {
        disposeFaceLandmarker();
        disposeLiveness();
        disposeRecognition();
        result = null;
        break;
      }

      default:
        throw new Error(`Unknown vision worker message type: ${type}`);
    }

    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: (e as Error).message });
  }
});
