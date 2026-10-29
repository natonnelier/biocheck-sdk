import { MINIFAS } from "../config.js";
import type { Box } from "./face-geometry.js";

/**
 * MiniFASNetV2 crop box, ported from Minivision `CropImage._get_new_box`
 * (src/generate_patches.py): scale the face box by `scale` around its centre,
 * shrinking the scale so the box fits the image, then shift it inside.
 * Returns integer pixel bounds (inclusive right/bottom, as in the original).
 */
export function passiveCropBox(
  box: Box,
  srcW: number,
  srcH: number,
  scale: number = MINIFAS.CROP_SCALE
): { x: number; y: number; width: number; height: number } {
  const s = Math.min((srcH - 1) / box.height, (srcW - 1) / box.width, scale);
  const newW = box.width * s;
  const newH = box.height * s;
  const cx = box.width / 2 + box.x;
  const cy = box.height / 2 + box.y;
  let x0 = cx - newW / 2;
  let y0 = cy - newH / 2;
  let x1 = cx + newW / 2;
  let y1 = cy + newH / 2;
  if (x0 < 0) { x1 -= x0; x0 = 0; }
  if (y0 < 0) { y1 -= y0; y0 = 0; }
  if (x1 > srcW - 1) { x0 -= x1 - srcW + 1; x1 = srcW - 1; }
  if (y1 > srcH - 1) { y0 -= y1 - srcH + 1; y1 = srcH - 1; }
  const l = Math.trunc(x0), t = Math.trunc(y0), r = Math.trunc(x1), b = Math.trunc(y1);
  return { x: l, y: t, width: r - l + 1, height: b - t + 1 };
}

/** Crops 2.7× the face box and resizes it to 80×80 (bilinear, as cv2.resize). */
export function cropForPassive(source: ImageBitmap, face: Box): ImageData {
  const size = MINIFAS.INPUT_SIZE;
  const c = passiveCropBox(face, source.width, source.height);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(source, c.x, c.y, c.width, c.height, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

/**
 * RGBA → NCHW float32 for MiniFASNetV2: BGR channel order (OpenCV), values
 * in 0–255. Minivision's `to_tensor` deliberately skips the /255
 * ("# return img.float().div(255)  modify by zkx").
 */
export function toMiniFasTensor(img: ImageData): Float32Array {
  return toChw(img, [2, 1, 0]);
}

/**
 * RGBA → NCHW float32 for SFace: RGB, 0–255, no mean subtraction. Matches
 * OpenCV `FaceRecognizerSF::feature`:
 * `blobFromImage(aligned, 1, Size(112, 112), Scalar(0, 0, 0), swapRB=true)`
 * on a BGR image, i.e. RGB planes with raw pixel values.
 */
export function toSFaceTensor(img: ImageData): Float32Array {
  return toChw(img, [0, 1, 2]);
}

/** `order[k]` is the RGBA channel written to output plane k. */
function toChw(img: ImageData, order: readonly [number, number, number]): Float32Array {
  const { data, width, height } = img;
  const n = width * height;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[i] = data[i * 4 + order[0]];
    out[n + i] = data[i * 4 + order[1]];
    out[2 * n + i] = data[i * 4 + order[2]];
  }
  return out;
}

/** Numerically stable softmax probability of class `index`. */
export function softmaxAt(logits: ArrayLike<number>, index: number): number {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += Math.exp(logits[i] - max);
  return Math.exp(logits[index] - max) / sum;
}
