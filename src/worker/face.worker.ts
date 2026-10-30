/**
 * Face worker — module Web Worker running MediaPipe Face Landmarker and ONNX
 * Runtime Web (SFace + MiniFASNetV2). MediaPipe loads its ES-module WASM
 * build (`vision_wasm_module_internal.js`) with import(), since importScripts
 * is unavailable in module workers.
 *
 * Everything biometric lives and dies here (thesis 3.3.2): the liveness state
 * machine, the passive-score crops, the document embedding, the selected
 * selfie frame, the cosine similarity and the threshold decision. Only
 * `FromWorker` messages leave, and none of them carries images, landmarks,
 * matrices or embeddings. The main thread terminates the worker at the end,
 * which discards all of it in one step.
 */
import * as ort from "onnxruntime-web";
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { BENCH, bench, round } from "../bench.js";
import { FACE_LANDMARKER, MINIFAS, SFACE } from "../config.js";
import { postToMain, type ToWorker, type WorkerConfig } from "../protocol.js";
import { cosineSimilarity } from "../utils/math.js";
import { alignFace } from "./align.js";
import { loadFaceLandmarker, loadOrtModels, type OrtModels } from "./engine.js";
import {
  blinkScore,
  faceBox,
  headPose,
  perspectiveRatio,
  userYaw,
  type Box,
  type Landmark,
} from "./face-geometry.js";
import { LivenessMachine, type FrameObservation, type StepOutcome } from "./liveness-machine.js";
import { cropForPassive, softmaxAt, toMiniFasTensor, toSFaceTensor } from "./preprocess.js";

let config: WorkerConfig | null = null;
let landmarker: FaceLandmarker | null = null;
let models: OrtModels | null = null;

let documentEmbedding: Float32Array | null = null;
let machine: LivenessMachine | null = null;
let finished = false;
let passiveCrops: ImageData[] = [];
let selfie: ImageData | null = null;

// Messages are handled strictly in order, one at a time.
let queue: Promise<void> = Promise.resolve();
self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  queue = queue.then(() => handle(msg));
});

async function handle(msg: ToWorker): Promise<void> {
  try {
    switch (msg.type) {
      case "init":
        return await init(msg.config, msg);
      case "document-photo":
        return await documentPhoto(msg.bitmap);
      case "liveness-start":
        return await livenessStart();
      case "frame":
        return await frame(msg.bitmap, msg.timestamp);
    }
  } catch (e) {
    if ("bitmap" in msg) msg.bitmap.close();
    postToMain({
      type: "error",
      code: msg.type === "init" ? "model_load_failed" : "internal_error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function init(cfg: WorkerConfig, msg: Extract<ToWorker, { type: "init" }>): Promise<void> {
  config = cfg;
  const t0 = performance.now();
  const [mp, ortModels] = await Promise.all([
    loadFaceLandmarker(msg.urls, cfg.detection.minConfidence),
    loadOrtModels(msg.urls),
  ]);
  landmarker = mp.landmarker;
  models = ortModels;
  bench("worker-ready", {
    loadMs: round(performance.now() - t0, 1),
    onnxruntime: ortModels.backend,
    mediapipe: mp.delegate,
  });
  postToMain({
    type: "ready",
    backends: { onnxruntime: ortModels.backend, mediapipe: mp.delegate },
  });
}

/** Document branch of thesis fig. 3.2: largest face, min width, align, embed. */
async function documentPhoto(bitmap: ImageBitmap): Promise<void> {
  const { landmarker, models, config } = ready();
  let aligned: ImageData | null = null;
  const t0 = performance.now();
  // Bench: every detected face (box relative to the image) and the one picked.
  const faces: Record<string, number>[] = [];
  let chosen = -1;
  const { width, height } = bitmap;
  try {
    const result = landmarker.detect(bitmap);
    let best: { landmarks: Landmark[]; box: Box } | null = null;
    for (const landmarks of result.faceLandmarks) {
      const box = faceBox(landmarks, bitmap.width, bitmap.height);
      if (BENCH) {
        faces.push({
          x: round(box.x / width), y: round(box.y / height),
          w: round(box.width / width), h: round(box.height / height), widthPx: Math.round(box.width),
        });
      }
      if (!best || box.width > best.box.width) {
        best = { landmarks, box };
        chosen = faces.length - 1;
      }
    }
    if (best && best.box.width >= config.photoMinWidth) aligned = alignFace(bitmap, best.landmarks);
  } finally {
    bitmap.close();
  }
  // Computed right away: it does not depend on the liveness check.
  documentEmbedding = aligned ? await embed(models, aligned) : null;
  bench("document-photo", {
    image: `${width}x${height}`,
    faces,
    chosen,
    minWidthPx: config.photoMinWidth,
    valid: documentEmbedding !== null,
    ms: round(performance.now() - t0, 1),
  });
  postToMain({ type: "document-result", valid: documentEmbedding !== null });
}

async function livenessStart(): Promise<void> {
  const { landmarker, config } = ready();
  await landmarker.setOptions({ runningMode: "VIDEO", numFaces: FACE_LANDMARKER.VIDEO_NUM_FACES });
  machine = new LivenessMachine({
    ...config.liveness,
    minFaceWidthRatio: config.detection.minFaceWidthRatio,
    maxAngleDegrees: config.comparison.maxAngleDegrees,
  });
  finished = false;
  passiveCrops = [];
  selfie = null;
}

async function frame(bitmap: ImageBitmap, timestamp: number): Promise<void> {
  const { landmarker, models, config } = ready();
  if (!machine || finished) {
    bitmap.close();
    return;
  }
  let out: StepOutcome;
  const t0 = performance.now();
  try {
    const result = landmarker.detectForVideo(bitmap, timestamp);
    const { observation, landmarks, box } = observe(result, bitmap.width, bitmap.height, timestamp);
    out = machine.step(observation);
    if (BENCH) {
      const o = observation;
      bench("frame", {
        ms: round(performance.now() - t0, 1),
        faces: o.faceCount,
        widthRatio: round(o.faceWidthRatio),
        blink: round(o.blink),
        yaw: round(o.yaw, 1),
        pitch: round(o.pitch, 1),
        perspective: round(o.perspective),
        status: out.status,
        challenge: out.challenge ? `${out.challenge.kind}${out.challenge.side ? `:${out.challenge.side}` : ""}` : null,
        challengeIndex: out.challengeIndex,
        hint: out.hint ?? null,
      });
    }
    if (out.reset) {
      passiveCrops = [];
      selfie = null;
    }
    if (landmarks && box) {
      if (out.takePassiveSample) passiveCrops.push(cropForPassive(bitmap, box));
      if (out.selfieCandidate) selfie = alignFace(bitmap, landmarks);
    }
  } finally {
    bitmap.close();
  }

  if (out.status === "waiting_face" || out.status === "challenge") {
    postToMain({
      type: "state",
      state: out.status,
      challenge: out.challenge,
      challengeIndex: out.challengeIndex,
      challengeTotal: out.challengeTotal,
      hint: out.hint,
    });
    return;
  }

  finished = true;
  bench("liveness-end", {
    status: out.status,
    challengeIndex: out.challengeIndex,
    challengeTotal: out.challengeTotal,
  });
  postToMain({ type: "state", state: "processing" });
  postToMain(
    out.status === "passed" ? await decide(models, config) : { type: "result", accepted: false }
  );
  passiveCrops = [];
  selfie = null;
  documentEmbedding = null;
}

/** Passive score, then embedding, similarity and threshold (thesis 3.3.3). */
async function decide(
  models: OrtModels,
  config: WorkerConfig
): Promise<{ type: "result"; accepted: boolean; score?: number }> {
  if (passiveCrops.length < config.liveness.passiveFrames || !selfie || !documentEmbedding) {
    bench("decision", {
      stage: "missing input",
      passiveCrops: passiveCrops.length,
      selfie: selfie !== null,
      documentEmbedding: documentEmbedding !== null,
    });
    return { type: "result", accepted: false };
  }
  let sum = 0;
  const scores: number[] = [];
  for (const crop of passiveCrops) {
    const s = await passiveScore(models, crop);
    sum += s;
    if (BENCH) scores.push(round(s, 4));
  }
  const passive = sum / passiveCrops.length;
  bench("passive", {
    scores,
    mean: round(passive, 4),
    threshold: config.liveness.passiveThreshold,
    passed: passive >= config.liveness.passiveThreshold,
  });
  if (passive < config.liveness.passiveThreshold) {
    return { type: "result", accepted: false };
  }
  const score = cosineSimilarity(documentEmbedding, await embed(models, selfie));
  bench("decision", {
    stage: "comparison",
    similarity: round(score, 4),
    threshold: config.decision.threshold,
    accepted: score >= config.decision.threshold,
  });
  return { type: "result", accepted: score >= config.decision.threshold, score };
}

function observe(
  result: FaceLandmarkerResult,
  width: number,
  height: number,
  t: number
): { observation: FrameObservation; landmarks?: Landmark[]; box?: Box } {
  const faceCount = result.faceLandmarks.length;
  if (faceCount !== 1) {
    return {
      observation: { t, faceCount, faceWidthRatio: 0, blink: 0, yaw: 0, pitch: 0, perspective: 0 },
    };
  }
  const landmarks = result.faceLandmarks[0];
  const box = faceBox(landmarks, width, height);
  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  const pose = matrix ? headPose(matrix) : { yaw: 0, pitch: 0 };
  return {
    observation: {
      t,
      faceCount,
      faceWidthRatio: box.width / width,
      blink: blinkScore(result.faceBlendshapes?.[0]?.categories ?? []),
      yaw: userYaw(pose.yaw),
      pitch: pose.pitch,
      perspective: perspectiveRatio(landmarks, width, height),
    },
    landmarks,
    box,
  };
}

async function embed(models: OrtModels, aligned: ImageData): Promise<Float32Array> {
  const s = models.sface;
  const input = new ort.Tensor("float32", toSFaceTensor(aligned), [
    1, 3, SFACE.INPUT_SIZE, SFACE.INPUT_SIZE,
  ]);
  const out = await s.run({ [s.inputNames[0]]: input });
  return new Float32Array(out[s.outputNames[0]].data as Float32Array);
}

async function passiveScore(models: OrtModels, crop: ImageData): Promise<number> {
  const s = models.minifas;
  const input = new ort.Tensor("float32", toMiniFasTensor(crop), [
    1, 3, MINIFAS.INPUT_SIZE, MINIFAS.INPUT_SIZE,
  ]);
  const out = await s.run({ [s.inputNames[0]]: input });
  return softmaxAt(out[s.outputNames[0]].data as Float32Array, MINIFAS.REAL_CLASS_INDEX);
}

function ready(): { landmarker: FaceLandmarker; models: OrtModels; config: WorkerConfig } {
  if (!landmarker || !models || !config) throw new Error("face worker not initialised");
  return { landmarker, models, config };
}
