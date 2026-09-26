/** With no viewfinder rebuild for this long, pooled mesh buffers are let go; the next rebuild allocates afresh. */
export const POOL_IDLE_RELEASE_MS = 5 * 60_000;

/** Free buffers kept at most; past it the smallest goes, being the one least likely to fit. */
const MAX_FREE = 64;

/** Rounded up to an eighth of the next power of two, so a mesh a little larger than the last still fits its buffer. */
export const poolSize = (bytes: number): number => {
  if (bytes <= 1024) return 1024;
  const step = 2 ** (Math.ceil(Math.log2(bytes)) - 3);
  return Math.ceil(bytes / step) * step;
};

/** One one-shot timer that every `touch` re-arms; it runs `release` once the pool has sat unused for `ms`. */
export class IdleRelease {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly release: () => void,
    private readonly ms = POOL_IDLE_RELEASE_MS
  ) {}

  touch(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.release();
    }, this.ms);
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * Free ArrayBuffers for typed arrays that are rebuilt again and again. A request takes the smallest
 * buffer that fits, else a new one; buffers never shrink, so the pool settles at the largest mesh seen.
 */
export class BufferPool {
  private free: ArrayBuffer[] = [];
  private readonly idle: IdleRelease;

  constructor(ms = POOL_IDLE_RELEASE_MS) {
    this.idle = new IdleRelease(() => (this.free = []), ms);
  }

  /** A buffer of at least `bytes`; its contents are whatever the last user left. */
  take(bytes: number): ArrayBuffer {
    this.idle.touch();
    let best = -1;
    for (let i = 0; i < this.free.length; i++) {
      const len = this.free[i].byteLength;
      if (len >= bytes && (best < 0 || len < this.free[best].byteLength)) best = i;
    }
    if (best < 0) return new ArrayBuffer(poolSize(bytes));
    const [buf] = this.free.splice(best, 1);
    return buf;
  }

  /** Back into the pool; a detached buffer (transferred away meanwhile) is ignored. */
  give(buf: ArrayBuffer): void {
    this.idle.touch();
    if (buf.byteLength === 0 || this.free.includes(buf)) return;
    this.free.push(buf);
    if (this.free.length > MAX_FREE) {
      let min = 0;
      for (let i = 1; i < this.free.length; i++) if (this.free[i].byteLength < this.free[min].byteLength) min = i;
      this.free.splice(min, 1);
    }
  }

  f32(n: number): Float32Array<ArrayBuffer> {
    return new Float32Array(this.take(n * 4), 0, n);
  }

  u32(n: number): Uint32Array<ArrayBuffer> {
    return new Uint32Array(this.take(n * 4), 0, n);
  }

  /** Free bytes held, for tests and debug readouts. */
  get bytes(): number {
    return this.free.reduce((s, b) => s + b.byteLength, 0);
  }

  get size(): number {
    return this.free.length;
  }
}
