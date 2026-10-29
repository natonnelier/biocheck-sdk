import { BiocheckError } from "./errors.js";
import type { FromWorker, ToWorker } from "./protocol.js";

type Of<T extends FromWorker["type"]> = Extract<FromWorker, { type: T }>;
type StateMsg = Of<"state">;

/** Main-thread end of the face-worker protocol. */
export class FaceWorkerClient {
  private readonly worker: Worker;
  private readonly waiters = new Map<FromWorker["type"], (msg: FromWorker) => void>();
  private failureReason: BiocheckError | null = null;
  private rejectFailure!: (e: BiocheckError) => void;
  /** Rejects as soon as the worker reports an error or crashes. Never resolves. */
  readonly failure: Promise<never>;
  onState: ((msg: StateMsg) => void) | null = null;

  constructor() {
    this.failure = new Promise<never>((_, reject) => (this.rejectFailure = reject));
    this.failure.catch(() => {}); // observed through race(); avoid unhandled rejections
    this.worker = new Worker(new URL("./worker/face.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.addEventListener("message", (e: MessageEvent<FromWorker>) => this.dispatch(e.data));
    this.worker.addEventListener("error", (e) =>
      this.fail(new BiocheckError("internal_error", `Face worker crashed: ${e.message}`))
    );
  }

  post(msg: ToWorker): void {
    const transfer = "bitmap" in msg ? [msg.bitmap] : [];
    this.worker.postMessage(msg, transfer);
  }

  /** Resolves with the next message of `type`, or rejects on worker failure. */
  next<T extends FromWorker["type"]>(type: T): Promise<Of<T>> {
    if (this.failureReason) return Promise.reject(this.failureReason);
    const p = new Promise<Of<T>>((resolve) =>
      this.waiters.set(type, (m) => resolve(m as Of<T>))
    );
    return this.race(p);
  }

  /** Races `p` against a worker failure. */
  race<T>(p: Promise<T>): Promise<T> {
    return Promise.race([p, this.failure]);
  }

  terminate(): void {
    this.worker.terminate();
    this.waiters.clear();
  }

  private dispatch(msg: FromWorker): void {
    if (msg.type === "error") {
      this.fail(new BiocheckError(msg.code, msg.message));
      return;
    }
    if (msg.type === "state") this.onState?.(msg);
    const waiter = this.waiters.get(msg.type);
    if (waiter) {
      this.waiters.delete(msg.type);
      waiter(msg);
    }
  }

  private fail(e: BiocheckError): void {
    if (this.failureReason) return;
    this.failureReason = e;
    this.rejectFailure(e);
  }
}
