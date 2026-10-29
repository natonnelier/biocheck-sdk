import { SFACE } from "../config.js";
import type { Landmark } from "./face-geometry.js";

/**
 * 5-point similarity alignment to 112×112 (thesis 3.2.4), shared by the
 * document photo and the selfie frame.
 *
 * ArcFace / OpenCV `FaceRecognizerSF::alignCrop` targets, in IMAGE order:
 * [0] eye on the image left, [1] eye on the image right, [2] nose tip,
 * [3] mouth corner on the image left, [4] mouth corner on the image right.
 */
export const ARCFACE_TARGET: ReadonlyArray<Point> = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

/**
 * Face mesh indices in the same IMAGE order, for an un-mirrored image.
 * MediaPipe names sides from the subject's point of view: 468 is the centre
 * of the subject's RIGHT iris (469–472, next to eye corner 33), which appears
 * on the image LEFT; 473 is the subject's left iris. 61 / 291 are the
 * subject's right / left mouth corners. So index i maps to ARCFACE_TARGET[i]
 * without mirroring.
 */
export const ALIGNMENT_LANDMARKS = [468, 473, 4, 61, 291] as const;

export interface Point {
  x: number;
  y: number;
}

/** Canvas 2D transform: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Transform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Least-squares similarity transform (rotation + uniform scale + translation). */
export function estimateSimilarityTransform(
  src: ReadonlyArray<Point>,
  dst: ReadonlyArray<Point>
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

/** Source points (pixels) for the alignment, in ARCFACE_TARGET order. */
export function alignmentPoints(
  landmarks: readonly Landmark[],
  width: number,
  height: number
): Point[] {
  return ALIGNMENT_LANDMARKS.map((i) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height }));
}

/** Warps the face to a 112×112 RGBA crop, with bilinear sampling. */
export function alignFace(source: ImageBitmap, landmarks: readonly Landmark[]): ImageData {
  const size = SFACE.INPUT_SIZE;
  const t = estimateSimilarityTransform(
    alignmentPoints(landmarks, source.width, source.height),
    ARCFACE_TARGET
  );
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  ctx.drawImage(source, 0, 0);
  ctx.resetTransform();
  return ctx.getImageData(0, 0, size, size);
}
