import { describe, it, expect } from "vitest";
import {
  ARCFACE_TARGET,
  ALIGNMENT_LANDMARKS,
  estimateSimilarityTransform,
} from "../src/worker/align.js";
import { blinkScore, faceBox, headPose } from "../src/worker/face-geometry.js";
import { passiveCropBox, softmaxAt, toMiniFasTensor, toSFaceTensor } from "../src/worker/preprocess.js";

/** 4×4 pose = Ry(yaw)·Rx(pitch), flattened COLUMN-major like MediaPipe. */
function poseMatrix(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const rx = [[1, 0, 0], [0, Math.cos(p), -Math.sin(p)], [0, Math.sin(p), Math.cos(p)]];
  const r = ry.map((row) => [0, 1, 2].map((c) => row.reduce((s, v, k) => s + v * rx[k][c], 0)));
  const m = new Array(16).fill(0);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[col * 4 + row] = r[row][col];
  m[15] = 1;
  m[14] = -40; // translation (column 3) must not leak into the angles
  return m;
}

describe("headPose", () => {
  it("reads yaw and pitch from a column-major matrix", () => {
    for (const [yaw, pitch] of [[25, 0], [-30, 0], [0, 12], [18, -9]]) {
      const r = headPose(poseMatrix(yaw, pitch));
      expect(r.yaw).toBeCloseTo(yaw, 6);
      expect(r.pitch).toBeCloseTo(pitch, 6);
    }
  });

  it("would get the yaw sign wrong if read row-major (the old bug)", () => {
    const m = poseMatrix(25, 0);
    const rowMajorSinYaw = -m[8]; // previous implementation
    expect(Math.sign(rowMajorSinYaw)).toBe(-1);
  });
});

describe("blinkScore", () => {
  it("averages eyeBlinkLeft and eyeBlinkRight by name", () => {
    const cats = [
      { categoryName: "_neutral", score: 0.9 },
      { categoryName: "eyeBlinkLeft", score: 0.6 },
      { categoryName: "eyeBlinkRight", score: 0.4 },
    ];
    expect(blinkScore(cats)).toBeCloseTo(0.5);
  });
});

describe("faceBox", () => {
  it("scales normalised extents to pixels", () => {
    const b = faceBox([{ x: 0.25, y: 0.5, z: 0 }, { x: 0.75, y: 0.75, z: 0 }], 640, 480);
    expect(b).toEqual({ x: 160, y: 240, width: 320, height: 120 });
  });
});

describe("estimateSimilarityTransform", () => {
  it("recovers an exact similarity", () => {
    const [s, th, tx, ty] = [0.4, 0.3, 12, -7];
    const src = ARCFACE_TARGET.map((p) => {
      // dst = s·R(θ)·src + t  ⇒  src = R(−θ)·(dst − t)/s
      const x = (p.x - tx) / s, y = (p.y - ty) / s;
      return { x: Math.cos(-th) * x - Math.sin(-th) * y, y: Math.sin(-th) * x + Math.cos(-th) * y };
    });
    const t = estimateSimilarityTransform(src, ARCFACE_TARGET);
    src.forEach((p, i) => {
      expect(t.a * p.x + t.c * p.y + t.e).toBeCloseTo(ARCFACE_TARGET[i].x, 6);
      expect(t.b * p.x + t.d * p.y + t.f).toBeCloseTo(ARCFACE_TARGET[i].y, 6);
    });
  });

  it("keeps the image-left eye on the image left (no mirroring)", () => {
    // In an un-mirrored image the subject's right iris (468) has the smaller x.
    expect(ALIGNMENT_LANDMARKS[0]).toBe(468);
    expect(ARCFACE_TARGET[0].x).toBeLessThan(ARCFACE_TARGET[1].x);
    const t = estimateSimilarityTransform(
      [{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 250, y: 260 }, { x: 210, y: 310 }, { x: 290, y: 310 }],
      ARCFACE_TARGET
    );
    expect(t.a).toBeGreaterThan(0); // no reflection, no 180° rotation
    expect(t.a * t.d - t.b * t.c).toBeGreaterThan(0);
  });
});

describe("passiveCropBox (Minivision _get_new_box)", () => {
  it("scales 2.7× around the centre when it fits", () => {
    const c = passiveCropBox({ x: 300, y: 200, width: 100, height: 100 }, 1280, 720);
    expect(c.width).toBe(271);
    expect(c.x).toBe(215);
    expect(c.y).toBe(115);
  });

  it("shrinks the scale and shifts the box inside the image", () => {
    const c = passiveCropBox({ x: 0, y: 0, width: 300, height: 300 }, 640, 480);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(640);
    expect(c.y + c.height).toBeLessThanOrEqual(480);
  });
});

describe("tensor layout", () => {
  // One pixel: R=10, G=20, B=30.
  const img = { data: new Uint8ClampedArray([10, 20, 30, 255]), width: 1, height: 1 } as ImageData;

  it("MiniFASNetV2: BGR, 0–255, no /255", () => {
    expect(Array.from(toMiniFasTensor(img))).toEqual([30, 20, 10]);
  });

  it("SFace: RGB, 0–255, no mean (OpenCV blobFromImage scale=1, swapRB)", () => {
    expect(Array.from(toSFaceTensor(img))).toEqual([10, 20, 30]);
  });

  it("softmax picks the real-class probability", () => {
    expect(softmaxAt([0, Math.log(3), 0], 1)).toBeCloseTo(0.6);
  });
});
