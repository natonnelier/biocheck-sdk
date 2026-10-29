import type { ModelId } from "../config.js";
import { BiocheckError } from "../errors.js";

/**
 * Runtime view of the model manifest (thesis 3.4.1). The build writes
 * `<modelsBaseUrl>/manifest.json`; every file is served from the same origin
 * under a content-hashed path, so it can be cached as immutable.
 */
export interface RuntimeManifest {
  files: Record<string, { path: string; version: string; size: number; sha256: string }>;
}

export type ModelUrl = (id: ModelId) => string;

export async function loadManifest(modelsBaseUrl: string): Promise<ModelUrl> {
  const base = new URL(modelsBaseUrl + "/", location.href);
  let manifest: RuntimeManifest;
  try {
    const res = await fetch(new URL("manifest.json", base), { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as RuntimeManifest;
  } catch (e) {
    throw new BiocheckError("model_load_failed", `Cannot load model manifest: ${String(e)}`);
  }
  return (id) => {
    const entry = manifest.files[id];
    if (!entry) throw new BiocheckError("model_load_failed", `Model "${id}" missing from manifest`);
    const url = new URL(entry.path, base);
    if (url.origin !== location.origin) {
      throw new BiocheckError("model_load_failed", `Model "${id}" is not same-origin`);
    }
    return url.href;
  };
}
