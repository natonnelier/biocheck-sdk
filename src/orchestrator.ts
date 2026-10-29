import { DOCUMENT_LAYOUT, MODEL_IDS } from "./config.js";
import { BiocheckError } from "./errors.js";
import { FaceWorkerClient } from "./face-client.js";
import { openCamera, stopCamera } from "./modules/camera.js";
import { loadManifest, type ModelUrl } from "./modules/manifest.js";
import { MrzReader } from "./modules/ocr.js";
import type { WorkerConfig } from "./protocol.js";
import type { DocumentType, ResolvedConfig, VerifyResult } from "./types.js";
import { S } from "./ui/strings.js";
import type { View } from "./ui/view.js";

const REJECTED: VerifyResult = { accepted: false };

/**
 * Coordinates the main thread side of one verification (thesis 3.3.3):
 * document phase (fig. 3.4) then face phase (fig. 3.5).
 */
export class Orchestrator {
  private face: FaceWorkerClient | null = null;
  private ocr: MrzReader | null = null;
  private stream: MediaStream | null = null;
  private faceReady = false;

  constructor(
    private readonly cfg: ResolvedConfig,
    private readonly view: View
  ) {}

  async run(): Promise<VerifyResult> {
    this.view.busy(S.preparing);
    const url = await loadManifest(this.cfg.modelsBaseUrl);

    // a. Stage 1 of the two-stage download: Tesseract.js + OCR-B, awaited.
    this.ocr = await MrzReader.create(
      { worker: url(MODEL_IDS.tesseractWorker), core: url(MODEL_IDS.tesseractCore), lang: url(MODEL_IDS.ocrb) },
      this.cfg.document
    );

    // b. Stage 2: face models download and warm up while the user works on
    //    the document. Not awaited here.
    this.face = new FaceWorkerClient();
    const ready = this.face.next("ready").then(() => void (this.faceReady = true));
    ready.catch(() => {});
    this.face.post({ type: "init", config: this.workerConfig(), urls: this.workerUrls(url) });

    const docType = await this.face.race(this.view.chooseDocumentType());
    this.view.busy(S.openingCamera);
    this.stream = await openCamera("environment", this.cfg.camera, { width: 1920, height: 1080 });
    await this.view.showCamera(this.stream, {
      mirrored: false,
      guideAspect: DOCUMENT_LAYOUT[docType].aspect,
      mrzMarker: true,
    });

    // c–d. MRZ image, validated, then Tesseract is terminated.
    const mrzImage = await this.captureMrz(docType);
    await this.ocr.terminate();
    this.ocr = null;
    if (!mrzImage) return REJECTED;

    // e–g. Photo image (DNI front, or the passport page already captured).
    this.view.setMrzMarker(false);
    const photoOk = await this.submitPhoto(docType, mrzImage, ready);
    stopCamera(this.stream);
    this.stream = null;
    this.view.hideCamera();
    if (!photoOk) return REJECTED;

    return this.facePhase();
  }

  /** Releases everything; terminating the face worker discards all biometric data. */
  async dispose(): Promise<void> {
    stopCamera(this.stream);
    this.stream = null;
    this.face?.terminate();
    this.face = null;
    const ocr = this.ocr;
    this.ocr = null;
    await ocr?.terminate().catch(() => {});
  }

  private async captureMrz(docType: DocumentType): Promise<ImageBitmap | null> {
    const max = this.cfg.document.maxCaptures;
    for (let attempt = 1; attempt <= max; attempt++) {
      const hint = attempt > 1 ? S.mrzRetry(attempt, max) : "";
      const image = await this.face!.race(this.view.captureDocument(S.mrzPrompt[docType], hint));
      this.view.busy(S.readingMrz);
      if (await this.face!.race(this.ocr!.read(image, docType))) return image;
      image.close();
    }
    return null;
  }

  private async submitPhoto(
    docType: DocumentType,
    mrzImage: ImageBitmap,
    ready: Promise<void>
  ): Promise<boolean> {
    const face = this.face!;
    const max = this.cfg.document.maxCaptures;
    if (docType === "dni") mrzImage.close();
    for (let attempt = 1; attempt <= max; attempt++) {
      let photo: ImageBitmap;
      if (docType === "passport" && attempt === 1) {
        photo = mrzImage;
      } else {
        const prompt = docType === "dni" ? S.photoPromptDni : S.photoPromptPassport;
        const hint = attempt > 1 ? S.photoRetry(attempt, max) : "";
        photo = await face.race(this.view.captureDocument(prompt, hint));
      }
      if (!this.faceReady) this.view.busy(S.waitingFaceModels);
      await face.race(ready);
      this.view.busy(S.analysingPhoto);
      const result = face.next("document-result");
      face.post({ type: "document-photo", bitmap: photo });
      if ((await result).valid) return true;
    }
    return false;
  }

  /** Liveness: one frame in flight at a time, driven by requestVideoFrameCallback. */
  private async facePhase(): Promise<VerifyResult> {
    const face = this.face!;
    this.view.busy(S.openingCamera);
    this.stream = await openCamera("user", this.cfg.camera, { width: 640, height: 480 });
    await this.view.showCamera(this.stream, { mirrored: true, guideAspect: null });
    this.view.message(S.lookAtCamera);
    const video = this.view.videoElement;

    let inFlight = false;
    let stopped = false;
    face.onState = (s) => {
      inFlight = false;
      if (s.state === "processing") stopped = true;
      this.view.showLiveness(s);
    };
    const result = face.next("result");
    face.post({ type: "liveness-start" });

    const onFrame = (now: DOMHighResTimeStamp) => {
      if (stopped) return;
      video.requestVideoFrameCallback(onFrame);
      if (inFlight) return; // drop: the previous frame's state has not arrived yet
      inFlight = true;
      createImageBitmap(video).then(
        (bitmap) => {
          if (stopped) bitmap.close();
          else face.post({ type: "frame", bitmap, timestamp: now });
        },
        () => {
          inFlight = false; // transient (e.g. video not ready): retry on the next frame
        }
      );
    };
    video.requestVideoFrameCallback(onFrame);

    // Liveness timeouts are driven by frame timestamps, so a camera that stops
    // delivering frames must end the verification here instead of hanging.
    const track = this.stream.getVideoTracks()[0];
    const ended = new Promise<never>((_, reject) =>
      track.addEventListener(
        "ended",
        () => reject(new BiocheckError("camera_unavailable", "Camera stopped during liveness")),
        { once: true }
      )
    );
    ended.catch(() => {});

    try {
      const r = await Promise.race([result, ended]);
      return r.score === undefined ? { accepted: r.accepted } : { accepted: r.accepted, score: r.score };
    } finally {
      stopped = true;
      face.onState = null;
    }
  }

  private workerConfig(): WorkerConfig {
    const { detection, liveness, comparison, decision, document } = this.cfg;
    return { detection, liveness, comparison, decision, photoMinWidth: document.photoMinWidth };
  }

  private workerUrls(url: ModelUrl) {
    return {
      faceLandmarker: url(MODEL_IDS.faceLandmarker),
      sface: url(MODEL_IDS.sface),
      minifasnet: url(MODEL_IDS.minifasnet),
      mediapipeLoader: url(MODEL_IDS.mediapipeLoader),
      mediapipeBinary: url(MODEL_IDS.mediapipeBinary),
      ortGlue: url(MODEL_IDS.ortGlue),
      ortBinary: url(MODEL_IDS.ortBinary),
    };
  }
}

