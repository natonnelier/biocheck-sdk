import type { FromWorker } from "../protocol.js";
import type { DocumentType } from "../types.js";
import { challengeText, hintText, S } from "./strings.js";

type StateMessage = Extract<FromWorker, { type: "state" }>;

/** Content of a blocking step-transition screen. */
export interface Notice {
  tone: "success" | "error" | "info";
  title: string;
  body?: string;
  items?: readonly string[];
  footer?: string;
  button: string;
}

const CSS = `
:host { display: block; }
.bc { font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f2f2f2;
  background: #111; border-radius: 12px; padding: 12px; display: flex; flex-direction: column;
  gap: 10px; max-width: 640px; margin: 0 auto; box-sizing: border-box; position: relative; }
.bc.has-notice { min-height: 380px; }
.stage { position: relative; width: 100%; overflow: hidden; border-radius: 8px; background: #000; }
.stage[hidden] { display: none; }
video { display: block; width: 100%; height: 100%; object-fit: fill; }
video.mirrored { transform: scaleX(-1); }
.guide { position: absolute; border: 3px solid rgba(255,255,255,.9); border-radius: 10px;
  box-shadow: 0 0 0 9999px rgba(0,0,0,.45); pointer-events: none; }
.guide[hidden] { display: none; }
.guide::after { content: ""; position: absolute; left: 4%; right: 4%; bottom: 6%; height: 30%;
  border: 2px dashed rgba(255,255,255,.55); border-radius: 4px; }
.guide.no-mrz::after { display: none; }
.prompt { margin: 0; font-size: 17px; font-weight: 600; text-align: center; min-height: 1.4em; }
.hint { margin: 0; color: #fbbf24; text-align: center; min-height: 1.4em; }
.progress { margin: 0; color: #a3a3a3; text-align: center; font-size: 13px; min-height: 1.2em; }
.actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
button { font: inherit; padding: 10px 18px; border: 0; border-radius: 8px; cursor: pointer;
  background: #2563eb; color: #fff; min-width: 120px; }
button.secondary { background: #3f3f46; }
button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.notice { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center;
  justify-content: center; padding: 16px; overflow: auto; border-radius: 12px;
  background: rgba(17,17,17,.75); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.notice[hidden] { display: none; }
.card { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 420px;
  padding: 22px 20px; box-sizing: border-box; border-radius: 12px; background: #1c1c1f;
  border: 1px solid #3f3f46; text-align: center; margin: auto; }
.card .icon { width: 48px; height: 48px; margin: 0 auto; border-radius: 50%; display: grid;
  place-items: center; font-size: 26px; font-weight: 700; color: #fff; }
.card.success .icon { background: #16a34a; }
.card.success .icon::before { content: "✓"; }
.card.error .icon { background: #dc2626; }
.card.error .icon::before { content: "!"; }
.card.info .icon { background: #2563eb; }
.card.info .icon::before { content: "i"; font-family: Georgia, serif; }
.card h2 { margin: 0; font-size: 20px; }
.card p { margin: 0; color: #d4d4d8; }
.card ul { margin: 0; padding-left: 22px; text-align: left; color: #f2f2f2; }
.card li + li { margin-top: 4px; }
.card button { align-self: center; margin-top: 4px; }
`;

/** Guide frame of aspect `aspect`, centred, at most 90 % of each side. */
export function guideRect(
  vw: number,
  vh: number,
  aspect: number
): { x: number; y: number; width: number; height: number } {
  let width = 0.9 * vw;
  let height = width / aspect;
  if (height > 0.9 * vh) {
    height = 0.9 * vh;
    width = height * aspect;
  }
  return { x: (vw - width) / 2, y: (vh - height) / 2, width, height };
}

/** The UI the SDK draws inside the client's container (thesis 3.3.1). */
export class View {
  private readonly host: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly noticeEl: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly video: HTMLVideoElement;
  private readonly guide: HTMLDivElement;
  private readonly promptEl: HTMLParagraphElement;
  private readonly hintEl: HTMLParagraphElement;
  private readonly progressEl: HTMLParagraphElement;
  private readonly actions: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;
  private guideAspect: number | null = null;

  constructor(container: HTMLElement) {
    this.host = document.createElement("div");
    const root = this.host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>
      <div class="bc" role="region" aria-label="Verificación de identidad">
        <div class="stage" hidden>
          <video muted autoplay playsinline></video>
          <div class="guide" hidden></div>
        </div>
        <p class="prompt" aria-live="polite"></p>
        <p class="hint" aria-live="polite"></p>
        <p class="progress"></p>
        <div class="actions"></div>
        <input type="file" accept="image/*" hidden>
        <div class="notice" hidden></div>
      </div>`;
    const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    this.panel = q(".bc");
    this.noticeEl = q(".notice");
    this.stage = q(".stage");
    this.video = q("video");
    this.guide = q(".guide");
    this.promptEl = q(".prompt");
    this.hintEl = q(".hint");
    this.progressEl = q(".progress");
    this.actions = q(".actions");
    this.fileInput = q("input");
    // Safari iOS plays video full-screen without playsinline.
    this.video.playsInline = true;
    container.appendChild(this.host);
  }

  message(prompt: string, hint = "", progress = ""): void {
    this.promptEl.textContent = prompt;
    this.hintEl.textContent = hint;
    this.progressEl.textContent = progress;
  }

  busy(prompt: string): void {
    this.message(prompt);
    this.actions.replaceChildren();
  }

  chooseDocumentType(): Promise<DocumentType> {
    this.message(S.chooseDocument);
    return new Promise((resolve) => {
      const dni = this.button(S.dni, () => resolve("dni"));
      const passport = this.button(S.passport, () => resolve("passport"));
      this.actions.replaceChildren(dni, passport);
    });
  }

  /**
   * Blocking step-transition screen drawn over the whole UI (camera included);
   * resolves when the user presses its button.
   */
  notice(n: Notice): Promise<void> {
    this.busy("");
    const card = document.createElement("div");
    card.className = `card ${n.tone}`;
    card.setAttribute("role", n.tone === "error" ? "alertdialog" : "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", n.title);
    const icon = document.createElement("div");
    icon.className = "icon";
    icon.setAttribute("aria-hidden", "true");
    const title = document.createElement("h2");
    title.textContent = n.title;
    card.append(icon, title);
    if (n.body) card.append(this.paragraph(n.body));
    if (n.items?.length) {
      const ul = document.createElement("ul");
      for (const text of n.items) {
        const li = document.createElement("li");
        li.textContent = text;
        ul.append(li);
      }
      card.append(ul);
    }
    if (n.footer) card.append(this.paragraph(n.footer));
    return new Promise((resolve) => {
      const button = this.button(n.button, () => {
        this.noticeEl.hidden = true;
        this.noticeEl.replaceChildren();
        this.panel.classList.remove("has-notice");
        resolve();
      });
      card.append(button);
      this.noticeEl.replaceChildren(card);
      this.panel.classList.add("has-notice");
      this.noticeEl.hidden = false;
      button.focus();
    });
  }

  /** Shows a camera stream. The face camera is mirrored on screen only. */
  async showCamera(
    stream: MediaStream,
    opts: { mirrored: boolean; guideAspect: number | null; mrzMarker?: boolean }
  ): Promise<void> {
    this.video.classList.toggle("mirrored", opts.mirrored);
    this.video.srcObject = stream;
    this.stage.hidden = false;
    await this.video.play();
    if (!this.video.videoWidth) {
      await new Promise((r) => this.video.addEventListener("loadedmetadata", r, { once: true }));
    }
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    this.stage.style.aspectRatio = `${vw} / ${vh}`;
    this.guideAspect = opts.guideAspect;
    this.guide.hidden = opts.guideAspect === null;
    this.guide.classList.toggle("no-mrz", !opts.mrzMarker);
    if (opts.guideAspect !== null) {
      const g = guideRect(vw, vh, opts.guideAspect);
      Object.assign(this.guide.style, {
        left: `${(100 * g.x) / vw}%`,
        top: `${(100 * g.y) / vh}%`,
        width: `${(100 * g.width) / vw}%`,
        height: `${(100 * g.height) / vh}%`,
      });
    }
  }

  setMrzMarker(visible: boolean): void {
    this.guide.classList.toggle("no-mrz", !visible);
  }

  hideCamera(): void {
    this.video.pause();
    this.video.srcObject = null;
    this.stage.hidden = true;
  }

  get videoElement(): HTMLVideoElement {
    return this.video;
  }

  /**
   * Waits for one document image: a camera photo cropped to the guide frame,
   * or an uploaded file (taken as the whole document).
   */
  captureDocument(prompt: string, hint = ""): Promise<ImageBitmap> {
    this.message(prompt, hint);
    return new Promise((resolve) => {
      let settled = false;
      const take = this.button(S.takePhoto, async () => {
        if (settled || !this.video.videoWidth || this.guideAspect === null) return;
        const g = guideRect(this.video.videoWidth, this.video.videoHeight, this.guideAspect);
        done(await createImageBitmap(this.video, g.x, g.y, g.width, g.height));
      });
      const upload = this.button(S.uploadFile, () => this.fileInput.click(), true);
      const onFile = async () => {
        const file = this.fileInput.files?.[0];
        this.fileInput.value = "";
        if (!file) return;
        try {
          done(await createImageBitmap(file));
        } catch {
          this.hintEl.textContent = "No se pudo abrir la imagen";
        }
      };
      const done = (bitmap: ImageBitmap) => {
        if (settled) {
          bitmap.close();
          return;
        }
        settled = true;
        this.fileInput.removeEventListener("change", onFile);
        this.actions.replaceChildren();
        resolve(bitmap);
      };
      this.fileInput.addEventListener("change", onFile);
      this.actions.replaceChildren(take, upload);
    });
  }

  showLiveness(s: StateMessage): void {
    if (s.state === "processing") {
      this.busy(S.processing);
      return;
    }
    const hint = s.hint ? hintText(s.hint) : "";
    if (s.state === "waiting_face" || !s.challenge) {
      this.message(S.lookAtCamera, hint);
      return;
    }
    const progress =
      s.challengeIndex !== undefined && s.challengeTotal
        ? S.challengeProgress(s.challengeIndex + 1, s.challengeTotal)
        : "";
    this.message(challengeText(s.challenge), hint, progress);
  }

  destroy(): void {
    this.hideCamera();
    this.host.remove();
  }

  private paragraph(text: string): HTMLParagraphElement {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  private button(label: string, onClick: () => void, secondary = false): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (secondary) b.className = "secondary";
    b.addEventListener("click", onClick);
    return b;
  }
}
