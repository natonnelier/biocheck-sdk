import { BENCH, bench, environment, round } from "./bench.js";
import { DOCUMENT_LAYOUT, MODEL_IDS } from "./config.js";
import { BiocheckError } from "./errors.js";
import { FaceWorkerClient } from "./face-client.js";
import { openCamera, stopCamera } from "./modules/camera.js";
import { loadManifest, type ModelUrl } from "./modules/manifest.js";
import { MrzReader } from "./modules/ocr.js";
import type { WorkerConfig } from "./protocol.js";
import type { DocumentType, ResolvedConfig, VerifyResult } from "./types.js";
import { S } from "./ui/strings.js";
import type { Notice, View } from "./ui/view.js";

/**
 * Coordinates the main thread side of one verification (thesis 3.3.3):
 * document phase (fig. 3.4) then face phase (fig. 3.5).
 */
export class Orchestrator {
  private face: FaceWorkerClient | null = null;
  private ocr: MrzReader | null = null;
  private stream: MediaStream | null = null;
  private faceReady = false;
  private startedAt = 0;

  constructor(
    private readonly cfg: ResolvedConfig,
    private readonly view: View
  ) {}

  async run(): Promise<VerifyResult> {
    this.startedAt = performance.now();
    if (BENCH) bench("session-start", await environment());
    this.view.busy(S.preparing);
    const url = await loadManifest(this.cfg.modelsBaseUrl);
    bench("manifest-loaded", { sinceStartMs: this.sinceStart() });

    // a. Stage 1 of the two-stage download: Tesseract.js + OCR-B, awaited.
    this.ocr = await MrzReader.create(
      { worker: url(MODEL_IDS.tesseractWorker), core: url(MODEL_IDS.tesseractCore), lang: url(MODEL_IDS.ocrb) },
      this.cfg.document
    );
    bench("ocr-ready", { sinceStartMs: this.sinceStart() });

    // b. Stage 2: face models download and warm up while the user works on
    //    the document. Not awaited here.
    this.face = new FaceWorkerClient();
    const ready = this.face.next("ready").then(() => {
      this.faceReady = true;
      bench("face-ready", { sinceStartMs: this.sinceStart() });
    });
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
    if (!mrzImage) return this.finish({ accepted: false }, S.result.documentRejected);

    // e–g. Photo image (DNI front, or the passport page already captured).
    this.view.setMrzMarker(false);
    if (docType === "dni") {
      await this.face.race(this.view.notice({ tone: "success", ...S.mrzOkDni, button: S.continue }));
    }
    const photoOk = await this.submitPhoto(docType, mrzImage, ready);
    if (photoOk) {
      await this.face.race(
        this.view.notice({
          tone: "success",
          title: S.documentOk.title[docType],
          body: S.documentOk.body,
          button: S.continue,
        })
      );
    }
    stopCamera(this.stream);
    this.stream = null;
    this.view.hideCamera();
    if (!photoOk) return this.finish({ accepted: false }, S.result.documentRejected);

    const result = await this.facePhase();
    return this.finish(result, result.accepted ? S.result.accepted : S.result.rejected);
  }

  /**
   * Final screen. The camera and the face worker (with all biometric data)
   * are released first, so nothing stays alive while the user reads it.
   */
  private async finish(
    result: VerifyResult,
    text: { title: string; body: string }
  ): Promise<VerifyResult> {
    stopCamera(this.stream);
    this.stream = null;
    this.view.hideCamera();
    this.face?.terminate();
    this.face = null;
    bench("result", { ...result, sinceStartMs: this.sinceStart() });
    const notice: Notice = { tone: result.accepted ? "success" : "error", ...text, button: S.finish };
    await this.view.notice(notice);
    return result;
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
      const hint = attempt > 1 ? S.attempt(attempt, max) : "";
      const image = await this.face!.race(this.view.captureDocument(S.mrzPrompt[docType], hint));
      this.view.busy(S.readingMrz);
      if (await this.face!.race(this.ocr!.read(image, docType))) {
        bench("mrz-summary", { docType, captures: attempt, accepted: true });
        return image;
      }
      image.close();
      if (attempt < max) {
        await this.face!.race(
          this.view.notice({
            tone: "error",
            title: S.mrzFailed.title,
            body: S.mrzFailed.body[docType],
            button: S.retry,
          })
        );
      }
    }
    bench("mrz-summary", { docType, captures: max, accepted: false });
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
        const hint = attempt > 1 ? S.attempt(attempt, max) : "";
        photo = await face.race(this.view.captureDocument(prompt, hint));
      }
      const waited = !this.faceReady;
      const waitStart = performance.now();
      if (waited) this.view.busy(S.waitingFaceModels);
      await face.race(ready);
      if (attempt === 1) {
        bench("face-wait", { waited, waitMs: round(performance.now() - waitStart, 1) });
      }
      this.view.busy(S.analysingPhoto);
      const result = face.next("document-result");
      face.post({ type: "document-photo", bitmap: photo });
      if ((await result).valid) {
        bench("photo-summary", { docType, captures: attempt, accepted: true });
        return true;
      }
      if (attempt < max) {
        await face.race(this.view.notice({ tone: "error", ...S.photoFailed, button: S.retry }));
      }
    }
    bench("photo-summary", { docType, captures: max, accepted: false });
    return false;
  }

  /** Liveness: one frame in flight at a time, driven by requestVideoFrameCallback. */
  private async facePhase(): Promise<VerifyResult> {
    const face = this.face!;
    this.view.busy(S.openingCamera);
    this.stream = await openCamera("user", this.cfg.camera, { width: 640, height: 480 });
    await this.view.showCamera(this.stream, { mirrored: true, guideAspect: null });
    // Explained over the live preview; the challenges start only on click.
    const { challengeCount, timeoutSeconds } = this.cfg.liveness;
    await face.race(
      this.view.notice({
        tone: "info",
        title: S.livenessIntro.title,
        body: S.livenessIntro.body(challengeCount, timeoutSeconds),
        items: S.livenessIntro.items,
        footer: S.livenessIntro.tips,
        button: S.start,
      })
    );
    this.view.message(S.lookAtCamera);
    const video = this.view.videoElement;

    let inFlight = false;
    let stopped = false;
    // Bench: camera frames delivered vs. frames processed by the worker.
    const fps = { start: performance.now(), delivered: 0, processedAt: [] as number[] };
    face.onState = (s) => {
      inFlight = false;
      if (BENCH) fps.processedAt.push(performance.now());
      if (s.state === "processing") stopped = true;
      this.view.showLiveness(s);
    };
    const result = face.next("result");
    face.post({ type: "liveness-start" });

    const onFrame = (now: DOMHighResTimeStamp) => {
      if (stopped) return;
      video.requestVideoFrameCallback(onFrame);
      fps.delivered++;
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
      if (BENCH) bench("liveness-fps", processedFps(fps.start, fps.delivered, fps.processedAt));
    }
  }

  private sinceStart(): number {
    return round(performance.now() - this.startedAt, 1);
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

/**
 * Processed frames per second over the liveness phase: the mean, and the
 * minimum over complete one-second windows (what the blink criterion of
 * consecutive frames depends on).
 */
function processedFps(start: number, delivered: number, processedAt: number[]): Record<string, unknown> {
  const seconds = ((processedAt.at(-1) ?? start) - start) / 1000;
  const windows = Math.floor(seconds);
  const perWindow = new Array<number>(windows).fill(0);
  for (const t of processedAt) {
    const i = Math.floor((t - start) / 1000);
    if (i < windows) perWindow[i]++;
  }
  return {
    seconds: round(seconds, 2),
    cameraFrames: delivered,
    processedFrames: processedAt.length,
    cameraFps: seconds > 0 ? round(delivered / seconds, 1) : null,
    meanFps: seconds > 0 ? round(processedAt.length / seconds, 1) : null,
    minFps: windows > 0 ? Math.min(...perWindow) : null,
    perSecond: perWindow,
  };
}
