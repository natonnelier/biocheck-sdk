import { describe, it, expect } from "vitest";
import { cosineSimilarity, secureRandomInt, shuffle } from "../src/utils/math.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  it("clamps to 0 for opposite vectors", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("returns 0 for zero vectors", () => {
    const z = new Float32Array([0, 0, 0]);
    expect(cosineSimilarity(z, z)).toBe(0);
  });
});

describe("secureRandomInt", () => {
  it("stays in range", () => {
    for (let i = 0; i < 1000; i++) {
      const r = secureRandomInt(3);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(3);
    }
  });
});

describe("shuffle (Fisher–Yates)", () => {
  it("is a permutation and does not mutate the input", () => {
    const input = ["a", "b", "c"];
    const out = shuffle(input);
    expect(out.slice().sort()).toEqual(["a", "b", "c"]);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("produces all 6 orders of 3 items with roughly equal frequency", () => {
    const counts = new Map<string, number>();
    const n = 60_000;
    for (let i = 0; i < n; i++) {
      const k = shuffle([0, 1, 2]).join("");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    // Expected 10 000 each; sort(() => random − 0.5) is visibly biased at this n.
    for (const c of counts.values()) expect(Math.abs(c - n / 6)).toBeLessThan(600);
  });
});
