import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  LivenessMachine,
  type FrameObservation,
  type LivenessParams,
} from "../src/worker/liveness-machine.js";

const params: LivenessParams = {
  ...DEFAULT_CONFIG.liveness,
  minFaceWidthRatio: DEFAULT_CONFIG.detection.minFaceWidthRatio,
  maxAngleDegrees: DEFAULT_CONFIG.comparison.maxAngleDegrees,
};

// Fisher–Yates over [blink, turn, move_closer] draws j = r(3) then j = r(2);
// the turn side is a further r(2) (0 = left).
/** j = 0, 0 → [turn, move_closer, blink], side left. */
const zero = () => 0;
/** j = 2, 1 (no swaps) → [blink, turn, move_closer]. */
const BLINK_FIRST = (n: number) => n - 1;
/** j = 0, 1 → [move_closer, turn, blink]. */
const MOVE_FIRST = (n: number) => (n === 3 ? 0 : 1);

const frontal: Omit<FrameObservation, "t"> = {
  faceCount: 1,
  faceWidthRatio: 0.3,
  blink: 0.05,
  yaw: 0,
  pitch: 0,
  perspective: 0.2,
};

function driver(p: LivenessParams = params, random = zero) {
  const m = new LivenessMachine(p, random);
  let t = 0;
  return {
    m,
    step(o: Partial<FrameObservation> = {}, dt = 33) {
      t += dt;
      return m.step({ ...frontal, ...o, t });
    },
  };
}

/** Completes the [turn left, move closer, blink] sequence from a fresh machine. */
function completeSequence(d: ReturnType<typeof driver>) {
  const outs = [d.step()]; // starts the sequence: turn left
  outs.push(d.step({ yaw: 25 }));
  outs.push(d.step({ yaw: 5 })); // → move closer, baseline width 0.3 / ratio 0.2
  outs.push(d.step({ faceWidthRatio: 0.4, perspective: 0.211 })); // → blink
  outs.push(d.step({ blink: 0.6 }));
  outs.push(d.step({ blink: 0.6 }));
  outs.push(d.step({ blink: 0.1 }));
  return outs;
}

describe("LivenessMachine", () => {
  it("waits for a valid face, with a hint", () => {
    const d = driver();
    expect(d.step({ faceCount: 0 })).toMatchObject({ status: "waiting_face", hint: "no_face" });
    expect(d.step({ faceCount: 2 })).toMatchObject({ hint: "multiple_faces" });
    expect(d.step({ faceWidthRatio: 0.2 })).toMatchObject({ hint: "face_too_small" });
  });

  it("presents the shuffled sequence and passes when every criterion is met", () => {
    const d = driver();
    const outs = completeSequence(d);
    expect(outs[0]).toMatchObject({ status: "challenge", challenge: { kind: "turn", side: "left" }, challengeIndex: 0 });
    expect(outs[2]).toMatchObject({ challenge: { kind: "move_closer" }, challengeIndex: 1 });
    expect(outs[3]).toMatchObject({ challenge: { kind: "blink" }, challengeIndex: 2 });
    expect(outs[6].status).toBe("passed");
  });

  it("takes one passive sample at the start of each challenge (3 over 3)", () => {
    const d = driver();
    const outs = completeSequence(d);
    const sampled = outs.flatMap((o, i) => (o.takePassiveSample ? [i] : []));
    expect(sampled).toEqual([0, 2, 3]);
  });

  it("blink needs 2 consecutive closed frames, then open below 0.3", () => {
    const b = driver({ ...params, challengeCount: 1 }, BLINK_FIRST);
    expect(b.step().challenge).toEqual({ kind: "blink" });
    expect(b.step({ blink: 0.6 }).status).toBe("challenge");
    expect(b.step({ blink: 0.1 }).status).toBe("challenge"); // only one closed frame: run resets
    expect(b.step({ blink: 0.6 }).status).toBe("challenge");
    expect(b.step({ blink: 0.6 }).status).toBe("challenge"); // closed
    expect(b.step({ blink: 0.4 }).status).toBe("challenge"); // hysteresis band
    expect(b.step({ blink: 0.2 }).status).toBe("passed");
  });

  it("a turn to the wrong side neither counts nor fails", () => {
    const d = driver({ ...params, challengeCount: 1 });
    expect(d.step().challenge).toEqual({ kind: "turn", side: "left" });
    expect(d.step({ yaw: -30 }).status).toBe("challenge");
    expect(d.step({ yaw: 0 }).status).toBe("challenge"); // returned, but never went left
    expect(d.step({ yaw: 21 }).status).toBe("challenge");
    expect(d.step({ yaw: 9 }).status).toBe("passed");
  });

  it("move closer needs both +30 % width and +5 % perspective", () => {
    const d = driver({ ...params, challengeCount: 1 }, MOVE_FIRST);
    expect(d.step().challenge).toEqual({ kind: "move_closer" });
    expect(d.step({ faceWidthRatio: 0.5, perspective: 0.2 }).status).toBe("challenge"); // flat photo
    expect(d.step({ faceWidthRatio: 0.35, perspective: 0.22 }).status).toBe("challenge"); // not enough width
    expect(d.step({ faceWidthRatio: 0.4, perspective: 0.211 }).status).toBe("passed");
  });

  it("an invalid frame restarts the sequence and drops recorded crops", () => {
    const d = driver();
    d.step();
    d.step({ yaw: 25 });
    const out = d.step({ faceCount: 2 });
    expect(out).toMatchObject({ status: "waiting_face", reset: true, hint: "multiple_faces", challengeIndex: 0 });
    // Restart: a fresh sequence from challenge 0, with a new passive sample.
    expect(d.step()).toMatchObject({ status: "challenge", challengeIndex: 0, takePassiveSample: true });
  });

  it("times out while waiting for a face", () => {
    const d = driver();
    d.step({ faceCount: 0 }, 0);
    expect(d.step({ faceCount: 0 }, 4900).status).toBe("waiting_face");
    expect(d.step({ faceCount: 0 }, 200).status).toBe("failed");
  });

  it("times out a challenge 5 s after it was presented", () => {
    const d = driver();
    d.step();
    expect(d.step({}, 4900).status).toBe("challenge");
    expect(d.step({}, 200).status).toBe("failed");
    expect(d.step().status).toBe("failed"); // final
  });

  it("restarting resets the timeout", () => {
    const d = driver();
    d.step();
    d.step({ faceCount: 0 }, 4000);
    expect(d.step({ faceCount: 0 }, 4000).status).toBe("waiting_face");
  });

  it("selects only frontal, eyes-open frames, improving monotonically", () => {
    const d = driver({ ...params, challengeCount: 1 });
    expect(d.step({ yaw: 10, pitch: 0 }).selfieCandidate).toBe(true);
    expect(d.step({ yaw: 16 }).selfieCandidate).toBe(false); // outside ±15°
    expect(d.step({ yaw: 3, blink: 0.35 }).selfieCandidate).toBe(false); // eyes not open
    expect(d.step({ yaw: 12 }).selfieCandidate).toBe(false); // less frontal than best
    expect(d.step({ yaw: 2, pitch: 1 }).selfieCandidate).toBe(true);
  });

  it("spreads passive samples when there are more than challenges", () => {
    const d = driver({ ...params, challengeCount: 1, passiveFrames: 3 });
    const outs = [d.step(), d.step(), d.step(), d.step()];
    expect(outs.map((o) => o.takePassiveSample)).toEqual([true, true, true, false]);
  });
});
