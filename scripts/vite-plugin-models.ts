/**
 * Serves (dev) and emits (build) the model and WASM runtime files listed in
 * models.manifest.json under content-hashed, same-origin paths:
 *
 *   <base>/manifest.json               → { files: { id: { path, version, size, sha256 } } }
 *   <base>/<sha256[:16]>/<file name>   → the file itself (immutable)
 *
 * The hash lives in the directory, not the file name, so runtimes that derive
 * a file name themselves (Tesseract.js: `${langPath}/${lang}.traineddata`)
 * still work. Each file is verified against the pinned size/SHA-256; a
 * mismatch fails the build. Files not yet downloaded are skipped with a warning.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Plugin } from "vite";

interface ManifestEntry {
  id: string;
  src: string;
  version: string;
  size: number | null;
  sha256: string | null;
}

interface Resolved {
  entry: ManifestEntry;
  file: string;
  path: string;
  size: number;
  sha256: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".json": "application/json",
};

export function biocheckModels(opts: {
  manifest: string;
  modelsDir: string;
  /** URL / output sub-path, without slashes. */
  base?: string;
}): Plugin {
  const base = opts.base ?? "models";
  let resolved: Resolved[] = [];

  const load = (strict: boolean, warn: (m: string) => void) => {
    const entries = (JSON.parse(readFileSync(opts.manifest, "utf8")) as { files: ManifestEntry[] }).files;
    resolved = [];
    for (const entry of entries) {
      const file = join(opts.modelsDir, entry.src);
      if (!existsSync(file)) {
        warn(`[biocheck-models] ${entry.id}: ${entry.src} not found (run npm run download-models)`);
        continue;
      }
      const bytes = readFileSync(file);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (entry.sha256 && (entry.sha256 !== sha256 || entry.size !== bytes.length)) {
        const msg = `[biocheck-models] ${entry.id}: ${entry.src} does not match the pinned size/SHA-256`;
        if (strict) throw new Error(msg);
        warn(msg);
      }
      resolved.push({ entry, file, path: `${sha256.slice(0, 16)}/${basename(entry.src)}`, size: bytes.length, sha256 });
    }
  };

  const runtimeManifest = () =>
    JSON.stringify({
      files: Object.fromEntries(
        resolved.map((r) => [r.entry.id, { path: r.path, version: r.entry.version, size: r.size, sha256: r.sha256 }])
      ),
    });

  return {
    name: "biocheck-models",

    configureServer(server) {
      load(false, (m) => server.config.logger.warn(m));
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const prefix = `/${base}/`;
        if (!url.startsWith(prefix)) return next();
        const rel = url.slice(prefix.length);
        const send = (body: Buffer | string, type: string, cache: string) => {
          res.setHeader("Content-Type", type);
          res.setHeader("Cache-Control", cache);
          res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          res.end(body);
        };
        if (rel === "manifest.json") return send(runtimeManifest(), "application/json", "no-cache");
        const hit = resolved.find((r) => r.path === rel);
        if (!hit) return next();
        const ext = hit.file.slice(hit.file.lastIndexOf("."));
        send(readFileSync(hit.file), CONTENT_TYPES[ext] ?? "application/octet-stream", "public, max-age=31536000, immutable");
      });
    },

    buildStart() {
      load(true, (m) => this.warn(m));
    },

    generateBundle() {
      for (const r of resolved) {
        this.emitFile({ type: "asset", fileName: `${base}/${r.path}`, source: readFileSync(r.file) });
      }
      this.emitFile({ type: "asset", fileName: `${base}/manifest.json`, source: runtimeManifest() });
    },
  };
}
