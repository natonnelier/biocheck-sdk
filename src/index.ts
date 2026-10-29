import { resolveConfig } from "./config.js";
import { BiocheckError } from "./errors.js";
import { assertBrowserSupport } from "./modules/support.js";
import { Orchestrator } from "./orchestrator.js";
import type { BiocheckConfig, VerifyResult } from "./types.js";
import { View } from "./ui/view.js";

export { BiocheckError } from "./errors.js";
export { DEFAULT_CONFIG } from "./config.js";
export type {
  BiocheckConfig,
  BiocheckErrorCode,
  ResolvedConfig,
  VerifyResult,
} from "./types.js";

/**
 * Runs a complete identity verification inside `container`, entirely in the
 * browser. The SDK draws its own UI (camera view, document guide frame,
 * capture buttons, challenge prompts) and opens and stops the camera itself.
 *
 * Resolves with `{ accepted, score? }`; `score` is present only if the
 * biometric comparison was reached. Rejects with a `BiocheckError` (typed
 * `code`) when the verification cannot complete: unsupported browser, camera
 * permission denied or unavailable, model load failure, invalid config.
 */
export async function verify(
  container: HTMLElement,
  config?: BiocheckConfig
): Promise<VerifyResult> {
  const cfg = resolveConfig(config);
  assertBrowserSupport();
  const view = new View(container);
  const orchestrator = new Orchestrator(cfg, view);
  try {
    return await orchestrator.run();
  } catch (e) {
    if (e instanceof BiocheckError) throw e;
    throw new BiocheckError("internal_error", e instanceof Error ? e.message : String(e));
  } finally {
    await orchestrator.dispose();
    view.destroy();
  }
}
