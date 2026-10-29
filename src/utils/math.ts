/** Cosine similarity clamped to [0, 1]: s = max(0, cos) (thesis eq. 3.1). */
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

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Returns an integer uniformly distributed in [0, n). */
export type RandomInt = (n: number) => number;

/**
 * Unbiased random integer in [0, n) from the CSPRNG, using rejection sampling
 * to avoid modulo bias. The challenge order must be unpredictable to an
 * attacker replaying a pre-recorded video.
 */
export const secureRandomInt: RandomInt = (n) => {
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new RangeError(`invalid n: ${n}`);
  const limit = 2 ** 32 - (2 ** 32 % n);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
};

/** Unbiased Fisher–Yates shuffle; returns a new array. */
export function shuffle<T>(items: readonly T[], randomInt: RandomInt = secureRandomInt): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
