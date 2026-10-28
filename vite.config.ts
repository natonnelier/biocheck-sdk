import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import { resolve } from "path";

const COOP_COEP_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [wasm()],
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
  },
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  worker: {
    // Classic (IIFE) workers: MediaPipe's WASM wrapper may call importScripts
    // which is unavailable in ES module workers.
    format: "iife",
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
