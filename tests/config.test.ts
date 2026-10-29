import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config.js";
import { BiocheckError } from "../src/errors.js";

describe("resolveConfig", () => {
  it("defaults to the values of thesis table 3.6", () => {
    const c = resolveConfig();
    expect(c.camera).toEqual({ minWidth: 640, minHeight: 480, minFrameRate: 15 });
    expect(c.detection).toEqual({ minConfidence: 0.8, minFaceWidthRatio: 0.25 });
    expect(c.liveness).toMatchObject({
      challengeCount: 3, timeoutSeconds: 5, blinkClosedThreshold: 0.5, blinkOpenThreshold: 0.3,
      blinkClosedFrames: 2, turnDegrees: 20, returnDegrees: 10, widthIncrease: 0.3,
      perspectiveIncrease: 0.05, passiveFrames: 3, passiveThreshold: 0.5,
    });
    expect(c.document).toEqual({ mrzCharHeightMin: 30, mrzCharHeightMax: 40, photoMinWidth: 112, maxCaptures: 3 });
    expect(c.comparison.maxAngleDegrees).toBe(15);
    expect(c.decision.threshold).toBe(0.363);
  });

  it("merges nested overrides without dropping sibling defaults", () => {
    const c = resolveConfig({ decision: { threshold: 0.5 }, liveness: { timeoutSeconds: 8 } });
    expect(c.decision.threshold).toBe(0.5);
    expect(c.liveness.timeoutSeconds).toBe(8);
    expect(c.liveness.challengeCount).toBe(DEFAULT_CONFIG.liveness.challengeCount);
  });

  it("rejects invalid values with a typed error", () => {
    expect(() => resolveConfig({ liveness: { challengeCount: 4 } })).toThrow(BiocheckError);
    try {
      resolveConfig({ liveness: { blinkOpenThreshold: 0.6 } });
    } catch (e) {
      expect((e as BiocheckError).code).toBe("invalid_config");
    }
  });
});
