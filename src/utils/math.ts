/** Cosine similarity clamped to [0, 1]. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.max(0, dot / denom);
}

/** Eye Aspect Ratio from 6 eye landmark points. */
export function eyeAspectRatio(points: Array<{ x: number; y: number }>): number {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const vertical1 = dist(points[1], points[5]);
  const vertical2 = dist(points[2], points[4]);
  const horizontal = dist(points[0], points[3]);
  return (vertical1 + vertical2) / (2 * horizontal);
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
