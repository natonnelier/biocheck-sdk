import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { FACE_LANDMARKER } from "../config.js";

let landmarker: FaceLandmarker | null = null;

export async function initFaceLandmarker(modelsBaseUrl: string): Promise<void> {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    `${modelsBaseUrl}/mediapipe/wasm`
  );
  landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: `${modelsBaseUrl}/${FACE_LANDMARKER.MODEL_FILE}`,
      delegate: "CPU",
    },
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    runningMode: "VIDEO",
    numFaces: FACE_LANDMARKER.NUM_FACES,
    minFaceDetectionConfidence: FACE_LANDMARKER.MIN_DETECTION_CONFIDENCE,
    minTrackingConfidence: FACE_LANDMARKER.MIN_TRACKING_CONFIDENCE,
  });
}

/**
 * Runs face landmarking on a single frame.
 * Accepts a video element (main thread) or an ImageBitmap (worker).
 * Must call initFaceLandmarker() first.
 */
export function detectFace(
  image: HTMLVideoElement | ImageBitmap,
  timestampMs: number
): FaceLandmarkerResult {
  if (!landmarker) throw new Error("FaceLandmarker not initialized");
  return landmarker.detectForVideo(image, timestampMs);
}

/**
 * Runs face landmarking on a static image (document photo extraction).
 * Switches running mode to IMAGE temporarily.
 */
export async function detectFaceInImage(
  image: ImageBitmap | HTMLImageElement | HTMLCanvasElement
): Promise<FaceLandmarkerResult> {
  if (!landmarker) throw new Error("FaceLandmarker not initialized");
  await landmarker.setOptions({ runningMode: "IMAGE" });
  const result = landmarker.detect(image);
  await landmarker.setOptions({ runningMode: "VIDEO" });
  return result;
}

export function disposeFaceLandmarker(): void {
  landmarker?.close();
  landmarker = null;
}
