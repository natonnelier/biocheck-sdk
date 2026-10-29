import type { Challenge, ChallengeKind, FrameHint, TurnSide } from "../protocol.js";
import type { ResolvedConfig } from "../types.js";
import { secureRandomInt, shuffle, type RandomInt } from "../utils/math.js";

/** Measurements of one processed frame (computed by the face worker). */
export interface FrameObservation {
  /** Frame timestamp in milliseconds (monotonic). */
  t: number;
  faceCount: number;
  /** Face-box width / frame width, of the only face. */
  faceWidthRatio: number;
  /** Mean eye-blink blendshape score. */
  blink: number;
  /** Degrees, positive towards the user's own left. */
  yaw: number;
  /** Degrees. */
  pitch: number;
  /** Nose width / face width. */
  perspective: number;
}

export type LivenessParams = ResolvedConfig["liveness"] & {
  minFaceWidthRatio: number;
  maxAngleDegrees: number;
};

export interface StepOutcome {
  /**
   * `passed`: all active challenges met (the passive check is still pending).
   * `failed`: a timeout expired.
   */
  status: "waiting_face" | "challenge" | "passed" | "failed";
  challenge?: Challenge;
  challengeIndex: number;
  challengeTotal: number;
  hint?: FrameHint;
  /** The sequence restarted: drop every crop recorded so far. */
  reset: boolean;
  /** Keep a MiniFASNetV2 crop of this frame. */
  takePassiveSample: boolean;
  /** This frame is the most frontal eyes-open frame so far: keep it. */
  selfieCandidate: boolean;
}

const CHALLENGE_KINDS: readonly ChallengeKind[] = ["blink", "turn", "move_closer"];

/**
 * Liveness state machine of thesis fig. 3.3:
 *
 *   waiting face ──valid frame──▶ challenge ──criterion met──▶ more left? ──no──▶ passed
 *        ▲  │                       │  ▲                          │yes
 *        │  └──timeout──▶ failed ◀──┘  └──────next challenge──────┘
 *        └────────invalid frame (new random order)──────┘
 *
 * Every state, including waiting for a face, has the same timeout. Any
 * invalid frame during the sequence restarts it with a new random order, with
 * no restart limit; rejection comes only from a timeout (or, later, from the
 * passive score).
 */
export class LivenessMachine {
  private phase: "waiting_face" | "challenge" | "passed" | "failed" = "waiting_face";
  private phaseStart: number | null = null;
  private sequence: Challenge[] = [];
  private index = 0;
  private passivePlan: number[] = [];
  private passiveTakenInChallenge = 0;
  private bestSelfie = Infinity;

  // Per-challenge progress.
  private closedRun = 0;
  private eyesClosed = false;
  private turnPeaked = false;
  private baseWidth = 0;
  private basePerspective = 0;

  constructor(
    private readonly p: LivenessParams,
    private readonly randomInt: RandomInt = secureRandomInt
  ) {}

  step(o: FrameObservation): StepOutcome {
    if (this.phaseStart === null) this.phaseStart = o.t;
    if (this.phase === "passed" || this.phase === "failed") return this.outcome({});

    const timedOut = o.t - this.phaseStart > this.p.timeoutSeconds * 1000;
    if (timedOut) {
      this.phase = "failed";
      return this.outcome({});
    }

    const hint = this.validate(o);

    if (this.phase === "waiting_face") {
      if (hint) return this.outcome({ hint });
      this.startSequence();
      return this.startChallenge(o);
    }

    // phase === "challenge"
    if (hint) {
      this.phase = "waiting_face";
      this.phaseStart = o.t;
      this.index = 0;
      this.bestSelfie = Infinity;
      return this.outcome({ hint, reset: true });
    }

    const selfieCandidate = this.considerSelfie(o);
    const takePassiveSample = this.considerPassive();
    if (!this.criterionMet(o)) return this.outcome({ takePassiveSample, selfieCandidate });

    this.index++;
    if (this.index === this.sequence.length) {
      this.phase = "passed";
      return this.outcome({ takePassiveSample, selfieCandidate });
    }
    const next = this.startChallenge(o);
    return {
      ...next,
      takePassiveSample: takePassiveSample || next.takePassiveSample,
      selfieCandidate: selfieCandidate || next.selfieCandidate,
    };
  }

  private validate(o: FrameObservation): FrameHint | undefined {
    if (o.faceCount === 0) return "no_face";
    if (o.faceCount > 1) return "multiple_faces";
    if (o.faceWidthRatio < this.p.minFaceWidthRatio) return "face_too_small";
    return undefined;
  }

  private startSequence(): void {
    const kinds = shuffle(CHALLENGE_KINDS, this.randomInt).slice(0, this.p.challengeCount);
    this.sequence = kinds.map((kind) =>
      kind === "turn"
        ? { kind, side: (this.randomInt(2) === 0 ? "left" : "right") as TurnSide }
        : { kind }
    );
    this.index = 0;
    // Spread the passive samples evenly over the challenges: sample k is taken
    // during challenge ⌊k·N/P⌋, starting at its first frame.
    const n = this.sequence.length;
    this.passivePlan = new Array(n).fill(0);
    for (let k = 0; k < this.p.passiveFrames; k++) {
      this.passivePlan[Math.floor((k * n) / this.p.passiveFrames)]++;
    }
    this.bestSelfie = Infinity;
  }

  /** Presents the current challenge; `o` is its first frame and its baseline. */
  private startChallenge(o: FrameObservation): StepOutcome {
    this.phase = "challenge";
    this.phaseStart = o.t;
    this.closedRun = 0;
    this.eyesClosed = false;
    this.turnPeaked = false;
    this.baseWidth = o.faceWidthRatio;
    this.basePerspective = o.perspective;
    this.passiveTakenInChallenge = 0;
    const selfieCandidate = this.considerSelfie(o);
    const takePassiveSample = this.considerPassive();
    return this.outcome({ takePassiveSample, selfieCandidate });
  }

  private considerPassive(): boolean {
    if (this.passiveTakenInChallenge >= this.passivePlan[this.index]) return false;
    this.passiveTakenInChallenge++;
    return true;
  }

  /** Most frontal valid frame with open eyes and |yaw|, |pitch| within limit. */
  private considerSelfie(o: FrameObservation): boolean {
    const max = this.p.maxAngleDegrees;
    if (o.blink >= this.p.blinkOpenThreshold) return false;
    if (Math.abs(o.yaw) > max || Math.abs(o.pitch) > max) return false;
    const frontality = o.yaw * o.yaw + o.pitch * o.pitch;
    if (frontality >= this.bestSelfie) return false;
    this.bestSelfie = frontality;
    return true;
  }

  private criterionMet(o: FrameObservation): boolean {
    const c = this.sequence[this.index];
    switch (c.kind) {
      case "blink":
        if (!this.eyesClosed) {
          this.closedRun = o.blink > this.p.blinkClosedThreshold ? this.closedRun + 1 : 0;
          if (this.closedRun >= this.p.blinkClosedFrames) this.eyesClosed = true;
          return false;
        }
        return o.blink < this.p.blinkOpenThreshold;
      case "turn": {
        // A turn to the wrong side neither counts nor fails the challenge.
        const towardsSide = c.side === "left" ? o.yaw : -o.yaw;
        if (!this.turnPeaked) {
          if (towardsSide > this.p.turnDegrees) this.turnPeaked = true;
          return false;
        }
        return Math.abs(o.yaw) < this.p.returnDegrees;
      }
      case "move_closer":
        return (
          this.baseWidth > 0 &&
          this.basePerspective > 0 &&
          o.faceWidthRatio / this.baseWidth >= 1 + this.p.widthIncrease &&
          o.perspective / this.basePerspective >= 1 + this.p.perspectiveIncrease
        );
    }
  }

  private outcome(
    extra: Partial<Pick<StepOutcome, "hint" | "reset" | "takePassiveSample" | "selfieCandidate">>
  ): StepOutcome {
    const inChallenge = this.phase === "challenge";
    return {
      status: this.phase,
      challenge: inChallenge ? this.sequence[this.index] : undefined,
      challengeIndex: this.index,
      challengeTotal: this.p.challengeCount,
      reset: false,
      takePassiveSample: false,
      selfieCandidate: false,
      ...extra,
    };
  }
}
