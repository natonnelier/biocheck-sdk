import * as ort from "onnxruntime-web";
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { bench, round } from "../bench.js";
import { FACE_LANDMARKER, MINIFAS, SFACE } from "../config.js";
import type { MediaPipeDelegate, OrtBackend, WorkerModelUrls } from "../protocol.js";

/**
 * Local inference engine (thesis 3.2.1, 3.4.2): loads the face models and
 * picks a backend for each runtime.
 */

export interface OrtModels {
  backend: OrtBackend;
  sface: ort.InferenceSession;
  minifas: ort.InferenceSession;
}

/**
 * ONNX Runtime Web: WASM with SIMD by default. Multithreading only when the
 * page is cross-origin isolated (SharedArrayBuffer); otherwise one thread.
 * The thread count mirrors ORT 1.30's own default (backend-wasm.ts):
 * min(4, ceil(cores / 2)); it is set explicitly so it does not depend on the
 * installed version.
 */
export function configureOrt(urls: WorkerModelUrls): void {
  // Explicit same-origin paths for both the JS glue and the binary, so ORT
  // never falls back to a CDN or to a path relative to the bundled worker.
  ort.env.wasm.wasmPaths = { mjs: urls.ortGlue, wasm: urls.ortBinary };
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, Math.ceil((navigator.hardwareConcurrency || 1) / 2))
    : 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = "error";
}

/**
 * Always warms up on WASM. If WebGPU exposes an adapter, warms up again on
 * WebGPU and keeps it only if it is faster. Each backend runs one untimed
 * inference per model (which compiles kernels / shaders) and then one timed
 * inference; the timed runs are compared.
 */
export async function loadOrtModels(urls: WorkerModelUrls): Promise<OrtModels> {
  configureOrt(urls);
  const [sfaceBytes, minifasBytes] = await Promise.all([
    fetchBytes(urls.sface),
    fetchBytes(urls.minifasnet),
  ]);

  const create = async (backend: OrtBackend): Promise<OrtModels> => {
    const opts: ort.InferenceSession.SessionOptions = { executionProviders: [backend] };
    const [sface, minifas] = await Promise.all([
      ort.InferenceSession.create(sfaceBytes, opts),
      ort.InferenceSession.create(minifasBytes, opts),
    ]);
    return { backend, sface, minifas };
  };

  const wasm = await create("wasm");
  const wasmMs = await timeWarmup(wasm);
  const report = (chosen: OrtBackend, webgpu: string, webgpuMs: number | null) =>
    bench("ort-backend", {
      chosen,
      wasmMs: round(wasmMs, 1),
      webgpuMs: webgpuMs === null ? null : round(webgpuMs, 1),
      webgpu,
      numThreads: ort.env.wasm.numThreads,
      crossOriginIsolated: self.crossOriginIsolated,
    });
  if (!(await hasWebGpuAdapter())) {
    report("wasm", "no adapter", null);
    return wasm;
  }

  let gpu: OrtModels | null = null;
  let gpuMs: number | null = null;
  try {
    gpu = await create("webgpu");
    gpuMs = await timeWarmup(gpu);
    if (gpuMs < wasmMs) {
      await release(wasm);
      report("webgpu", "faster", gpuMs);
      return gpu;
    }
    report("wasm", "slower", gpuMs);
  } catch (e) {
    // WebGPU unusable for these models (e.g. unsupported INT8 ops): keep WASM.
    report("wasm", `failed: ${e instanceof Error ? e.message : String(e)}`, gpuMs);
  }
  if (gpu) await release(gpu);
  return wasm;
}

async function timeWarmup(m: OrtModels): Promise<number> {
  const sfaceFeeds = {
    [m.sface.inputNames[0]]: new ort.Tensor(
      "float32",
      new Float32Array(3 * SFACE.INPUT_SIZE * SFACE.INPUT_SIZE),
      [1, 3, SFACE.INPUT_SIZE, SFACE.INPUT_SIZE]
    ),
  };
  const fasFeeds = {
    [m.minifas.inputNames[0]]: new ort.Tensor(
      "float32",
      new Float32Array(3 * MINIFAS.INPUT_SIZE * MINIFAS.INPUT_SIZE),
      [1, 3, MINIFAS.INPUT_SIZE, MINIFAS.INPUT_SIZE]
    ),
  };
  await m.sface.run(sfaceFeeds);
  await m.minifas.run(fasFeeds);
  const t0 = performance.now();
  await m.sface.run(sfaceFeeds);
  await m.minifas.run(fasFeeds);
  return performance.now() - t0;
}

async function hasWebGpuAdapter(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

async function release(m: OrtModels): Promise<void> {
  await Promise.all([m.sface.release(), m.minifas.release()]);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Face Landmarker: tries the GPU delegate (WebGL on an OffscreenCanvas inside
 * the worker) and falls back to CPU if initialisation or the first inference
 * fails. Starts in IMAGE mode for the document photo; `liveness-start`
 * switches it to VIDEO mode.
 */
export async function loadFaceLandmarker(
  urls: WorkerModelUrls,
  minConfidence: number
): Promise<{ landmarker: FaceLandmarker; delegate: MediaPipeDelegate }> {
  const fileset = { wasmLoaderPath: urls.mediapipeLoader, wasmBinaryPath: urls.mediapipeBinary };
  const modelAssetBuffer = await fetchBytes(urls.faceLandmarker);
  let lastError: unknown;
  const failures: Record<string, string> = {};
  for (const delegate of ["GPU", "CPU"] as const) {
    let landmarker: FaceLandmarker | null = null;
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer, delegate },
        runningMode: "IMAGE",
        numFaces: FACE_LANDMARKER.IMAGE_NUM_FACES,
        minFaceDetectionConfidence: minConfidence,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      // Warm-up: compiles the GPU programs and surfaces delegates that
      // initialise but cannot run.
      const blank = new OffscreenCanvas(64, 64);
      blank.getContext("2d")!.fillRect(0, 0, 64, 64);
      landmarker.detect(blank);
      bench("mediapipe-delegate", { chosen: delegate, failures });
      return { landmarker, delegate };
    } catch (e) {
      lastError = e;
      failures[delegate] = e instanceof Error ? e.message : String(e);
      landmarker?.close();
    }
  }
  throw lastError;
}
