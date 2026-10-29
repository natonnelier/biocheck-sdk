import { BiocheckError } from "../errors.js";

// Smallest module using a v128 instruction (same probe as wasm-feature-detect).
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

export function wasmSimdSupported(): boolean {
  try {
    return typeof WebAssembly === "object" && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

/** Detects `new Worker(url, { type: "module" })` without running any code. */
function moduleWorkersSupported(): boolean {
  if (typeof Worker === "undefined") return false;
  let supported = false;
  const url = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
  try {
    new Worker(url, {
      get type() {
        supported = true;
        return "module" as const;
      },
    }).terminate();
  } catch {
    supported = false;
  } finally {
    URL.revokeObjectURL(url);
  }
  return supported;
}

/**
 * Startup check (thesis 3.4.2, table 3.5). createImageBitmap and
 * requestVideoFrameCallback are mandatory. getUserMedia, module Web Workers
 * and WebAssembly SIMD are mandatory too: the camera is the input, and ORT Web ≥
 * 1.19 ships SIMD-only builds. SharedArrayBuffer, nested workers and
 * OffscreenCanvas with WebGL are optional and degrade gracefully inside the
 * face worker.
 */
export function assertBrowserSupport(): void {
  const missing: string[] = [];
  if (typeof createImageBitmap !== "function") missing.push("createImageBitmap");
  if (
    typeof HTMLVideoElement === "undefined" ||
    !("requestVideoFrameCallback" in HTMLVideoElement.prototype)
  ) {
    missing.push("requestVideoFrameCallback");
  }
  if (!navigator.mediaDevices?.getUserMedia) missing.push("getUserMedia (secure context required)");
  if (!moduleWorkersSupported()) missing.push("module Web Workers");
  if (!wasmSimdSupported()) missing.push("WebAssembly SIMD");
  if (missing.length) {
    throw new BiocheckError("browser_not_supported", `Missing: ${missing.join(", ")}`);
  }
}
