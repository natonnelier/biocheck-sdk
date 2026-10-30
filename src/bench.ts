/// <reference types="vite/client" />
/**
 * Benchmark logging for the thesis measurements (Chapters 4–5). Compiled in
 * only with VITE_BIOCHECK_BENCH=1 (e.g. `VITE_BIOCHECK_BENCH=1 npm run dev`);
 * in any other build BENCH is the literal `false` and every call is dead code.
 *
 * Bench mode prints MRZ fields, scores and per-frame face measurements to the
 * console (from the worker too): never enable it in a deployment.
 */
export const BENCH = import.meta.env.VITE_BIOCHECK_BENCH === "1";

/**
 * One `[biocheck:bench] {json}` line. `at` is epoch milliseconds, comparable
 * between the main thread and the worker (their performance.now() origins differ).
 */
export function bench(event: string, data: Record<string, unknown> = {}): void {
  if (!BENCH) return;
  const at = Math.round((performance.timeOrigin + performance.now()) * 10) / 10;
  console.info(`[biocheck:bench] ${JSON.stringify({ event, at, ...data })}`);
}

/** Rounds to `digits` decimals, for compact logs. */
export function round(x: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

interface UADataValues {
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  model?: string;
  fullVersionList?: { brand: string; version: string }[];
}

/** What the browser exposes about the device (CPU model and exact RAM are not exposed). */
export async function environment(): Promise<Record<string, unknown>> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { getHighEntropyValues(hints: string[]): Promise<UADataValues> };
  };
  let uaData: UADataValues | null = null;
  try {
    uaData =
      (await nav.userAgentData?.getHighEntropyValues([
        "platform",
        "platformVersion",
        "architecture",
        "model",
        "fullVersionList",
      ])) ?? null;
  } catch {
    // Chromium only; Firefox and Safari expose the user agent string alone.
  }
  return {
    userAgent: navigator.userAgent,
    uaData,
    logicalCores: navigator.hardwareConcurrency ?? null,
    // Chromium only, rounded and capped at 8 GB.
    deviceMemoryGB: nav.deviceMemory ?? null,
    crossOriginIsolated: self.crossOriginIsolated,
  };
}

/** Contents of every browser storage the SDK must leave empty (thesis privacy check). */
export async function storageSnapshot(): Promise<Record<string, unknown>> {
  const idb = indexedDB as IDBFactory & { databases?: () => Promise<IDBDatabaseInfo[]> };
  let indexedDBNames: string[] | null = null;
  try {
    indexedDBNames = idb.databases ? (await idb.databases()).map((d) => d.name ?? "") : null;
  } catch {
    // Unsupported: inspect manually in DevTools.
  }
  let cacheNames: string[] | null = null;
  try {
    cacheNames = "caches" in self ? await caches.keys() : null;
  } catch {
    // Insecure context.
  }
  return {
    localStorageKeys: Object.keys(localStorage),
    sessionStorageKeys: Object.keys(sessionStorage),
    indexedDB: indexedDBNames,
    cacheStorage: cacheNames,
  };
}
