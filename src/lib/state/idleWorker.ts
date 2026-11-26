/** Long enough that scrubbing the clock or nudging a point keeps the worker and its decoded tiles. */
export const WORKER_IDLE_MS = 60_000;

/** A worker spawned on the first post and terminated once its owner has nothing in flight for `idleMs`. */
export class IdleWorker<In, Out> {
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly spawn: () => Worker,
    private readonly onMessage: (m: Out) => void,
    private readonly idleMs = WORKER_IDLE_MS
  ) {}

  /** Sends a request; the worker stays until the owner settles and the span passes. */
  post(m: In): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.worker) {
      this.worker = this.spawn();
      this.worker.addEventListener('message', (e: MessageEvent<Out>) => this.onMessage(e.data));
    }
    this.worker.postMessage(m);
  }

  /** The newest request is answered for good; the idle countdown starts. */
  settle(): void {
    if (!this.worker) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.worker?.terminate();
      this.worker = null;
    }, this.idleMs);
  }

  get alive(): boolean {
    return this.worker !== null;
  }
}
