import { BiocheckError } from "../errors.js";
import type { ResolvedConfig } from "../types.js";

/**
 * Opens a camera with MINIMUM constraints from the configuration (thesis
 * 3.4.3), so a device below 640 × 480 or 15 fps fails here instead of
 * silently degrading the pipeline. `ideal` asks for more when available.
 */
export async function openCamera(
  facing: "user" | "environment",
  cam: ResolvedConfig["camera"],
  ideal: { width: number; height: number }
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { min: cam.minWidth, ideal: Math.max(ideal.width, cam.minWidth) },
        height: { min: cam.minHeight, ideal: Math.max(ideal.height, cam.minHeight) },
        frameRate: { min: cam.minFrameRate, ideal: Math.max(30, cam.minFrameRate) },
      },
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new BiocheckError("camera_permission_denied", "Camera permission denied");
    }
    // NotFoundError, NotReadableError, OverconstrainedError, AbortError…
    throw new BiocheckError("camera_unavailable", `Camera unavailable: ${name || String(e)}`);
  }
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}
