import { detectFaceInImage } from "./detection.js";
import { DOCUMENT_PHOTO } from "../config.js";

/**
 * Locates the largest face in a document image and returns a 112×112
 * aligned crop (5-point alignment). Returns null if no valid face is found.
 */
export async function extractDocumentPhoto(
  documentImage: ImageBitmap
): Promise<ImageData | null> {
  const result = await detectFaceInImage(documentImage);
  if (!result.faceLandmarks?.length) return null;

  // Pick the face with the largest bounding box (handles ghost image on new DNI)
  let largestIdx = 0;
  let largestWidth = 0;
  for (let i = 0; i < result.faceLandmarks.length; i++) {
    const lms = result.faceLandmarks[i];
    const xs = lms.map((p) => p.x);
    const width = Math.max(...xs) - Math.min(...xs);
    if (width > largestWidth) {
      largestWidth = width;
      largestIdx = i;
    }
  }

  const faceWidth = largestWidth * documentImage.width;
  if (faceWidth < DOCUMENT_PHOTO.MIN_FACE_WIDTH_PX) return null;

  const landmarks = result.faceLandmarks[largestIdx];
  return alignFace(documentImage, landmarks);
}

/**
 * Affine-aligns the face to a 112×112 canvas using 5 key landmarks:
 * left eye, right eye, nose tip, left mouth corner, right mouth corner.
 */
function alignFace(
  source: ImageBitmap,
  landmarks: Array<{ x: number; y: number; z: number }>
): ImageData {
  const W = source.width;
  const H = source.height;
  const SIZE = DOCUMENT_PHOTO.ALIGNED_SIZE;

  // MediaPipe landmark indices for 5-point alignment
  const LEFT_EYE = 468;
  const RIGHT_EYE = 473;
  const NOSE_TIP = 4;
  const LEFT_MOUTH = 61;
  const RIGHT_MOUTH = 291;

  const src = [
    { x: landmarks[LEFT_EYE].x * W, y: landmarks[LEFT_EYE].y * H },
    { x: landmarks[RIGHT_EYE].x * W, y: landmarks[RIGHT_EYE].y * H },
    { x: landmarks[NOSE_TIP].x * W, y: landmarks[NOSE_TIP].y * H },
    { x: landmarks[LEFT_MOUTH].x * W, y: landmarks[LEFT_MOUTH].y * H },
    { x: landmarks[RIGHT_MOUTH].x * W, y: landmarks[RIGHT_MOUTH].y * H },
  ];

  // Standard 112×112 target positions (ArcFace alignment)
  const dst = [
    { x: 38.2946, y: 51.6963 },
    { x: 73.5318, y: 51.5014 },
    { x: 56.0252, y: 71.7366 },
    { x: 41.5493, y: 92.3655 },
    { x: 70.7299, y: 92.2041 },
  ];

  const transform = estimateSimilarityTransform(src, dst);
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d")!;

  ctx.setTransform(
    transform.a, transform.b,
    transform.c, transform.d,
    transform.e, transform.f
  );
  ctx.drawImage(source, 0, 0);
  ctx.resetTransform();

  return ctx.getImageData(0, 0, SIZE, SIZE);
}

interface Transform {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

/** Least-squares similarity transform estimation (scale + rotation + translation). */
function estimateSimilarityTransform(
  src: Array<{ x: number; y: number }>,
  dst: Array<{ x: number; y: number }>
): Transform {
  const n = src.length;
  let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;

  for (let i = 0; i < n; i++) {
    srcMeanX += src[i].x;
    srcMeanY += src[i].y;
    dstMeanX += dst[i].x;
    dstMeanY += dst[i].y;
  }
  srcMeanX /= n; srcMeanY /= n;
  dstMeanX /= n; dstMeanY /= n;

  let a = 0, b = 0, srcVar = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i].x - srcMeanX;
    const sy = src[i].y - srcMeanY;
    const dx = dst[i].x - dstMeanX;
    const dy = dst[i].y - dstMeanY;
    a += sx * dx + sy * dy;
    b += sx * dy - sy * dx;
    srcVar += sx * sx + sy * sy;
  }

  const scale = srcVar === 0 ? 1 : Math.sqrt(a * a + b * b) / srcVar;
  const angle = Math.atan2(b, a);
  const cos = scale * Math.cos(angle);
  const sin = scale * Math.sin(angle);
  const tx = dstMeanX - cos * srcMeanX + sin * srcMeanY;
  const ty = dstMeanY - sin * srcMeanX - cos * srcMeanY;

  return { a: cos, b: sin, c: -sin, d: cos, e: tx, f: ty };
}
