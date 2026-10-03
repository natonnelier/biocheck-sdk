/**
 * Opens the front-facing camera and returns a MediaStream.
 * Requests 640×480 at up to 30 fps.
 */
export async function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { max: 30 },
    },
    audio: false,
  });
}

/** Grabs a single frame from a video element as an ImageData. */
export function captureFrame(video: HTMLVideoElement): ImageData {
  const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0);
  return ctx.getImageData(0, 0, video.videoWidth, video.videoHeight);
}

/** Grabs a single frame from a video element as an ImageBitmap. */
export async function captureFrameBitmap(
  video: HTMLVideoElement
): Promise<ImageBitmap> {
  return createImageBitmap(video);
}

/** Stops all tracks in a MediaStream. */
export function closeCamera(stream: MediaStream): void {
  stream.getTracks().forEach((t) => t.stop());
}
