import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import { resolve } from "path";

export default defineConfig({
  plugins: [wasm()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "BiocheckSDK",
      fileName: "biocheck-sdk",
    },
    rollupOptions: {
      // externalize deps that clients will provide
      external: [],
    },
    target: "es2022",
  },
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  worker: {
    format: "es",
  },
  // demo dev server
  root: ".",
  publicDir: "public",
});
