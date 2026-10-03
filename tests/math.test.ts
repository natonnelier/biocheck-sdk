import { describe, it, expect } from "vitest";
import { cosineSimilarity, eyeAspectRatio } from "../src/utils/math.js";

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

describe("eyeAspectRatio", () => {
  it("returns ~0 for fully closed eye (flat points)", () => {
    const pts = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 3, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 },
    ];
    expect(eyeAspectRatio(pts)).toBeCloseTo(0);
  });
});
