import { defaultClientConditions, defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import { resolve } from "path";
import { biocheckModels } from "./scripts/vite-plugin-models";

const COOP_COEP_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [
    wasm(),
    biocheckModels({
      manifest: resolve(__dirname, "models.manifest.json"),
      modelsDir: resolve(__dirname, "public/models"),
    }),
  ],
  resolve: {
    // Selects ORT's ort.min.mjs, whose WASM glue and binary are loaded from
    // env.wasm.wasmPaths. The default bundle references the 28 MB .wasm via
    // new URL(…, import.meta.url), which Vite would copy (or, in IIFE workers,
    // inline as base64) under an unhashed, unmanifested name.
    conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions],
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "BiocheckSDK",
      fileName: "biocheck-sdk",
    },
    rollupOptions: {
      external: [],
    },
    target: "es2022",
    // Models are emitted under hashed paths by biocheckModels(); copying
    // public/models verbatim would duplicate ~60 MB under unhashed names.
    copyPublicDir: false,
  },
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  worker: {
    // Module worker. MediaPipe ≥ 0.10.x loads its ES-module WASM build
    // (vision_wasm_module_internal.js) via import() when importScripts is
    // unavailable, so a classic worker is no longer required.
    format: "es",
  },
  root: ".",
  publicDir: "public",
  server: {
    open: "/demo/",
    headers: COOP_COEP_HEADERS,
  },
  preview: {
    headers: COOP_COEP_HEADERS,
  },
});
