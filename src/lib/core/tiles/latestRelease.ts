/** Follows a publisher's newest release, cache first: the one remembered from last load serves at once, and a stale one is re-checked in the background for the next load. */

/** Sources that publish dated releases the app follows. */
export const ReleaseSource = { Overture: 'Overture', Bag3d: 'Bag3d', Swiss: 'Swiss' } as const;
export type ReleaseSource = (typeof ReleaseSource)[keyof typeof ReleaseSource];

export interface KnownRelease {
  release: string;
  /** Epoch ms of the last answer from the publisher. */
  checkedAt: number;
}

export interface ReleaseMemory {
  get(): KnownRelease | null;
  set(k: KnownRelease): void;
}

export interface LatestReleaseDeps {
  /** Asks the publisher; null when it gave no usable answer. */
  check: (signal: AbortSignal) => Promise<string | null>;
  memory: ReleaseMemory;
  now: () => number;
  online: () => boolean;
  /** Runs a background check off the first-load path. */
  later: (run: () => void) => void;
}

/** A remembered release older than this is re-checked in the background. */
export const RELEASE_STALE_MS = 3 * 24 * 3600_000;
/** How long a first load, with nothing remembered, waits on the publisher. */
export const RELEASE_FIRST_TIMEOUT_MS = 5000;
const RELEASE_BACKGROUND_TIMEOUT_MS = 30_000;

export class LatestRelease {
  private session: Promise<string> | null = null;
  private redone = false;

  constructor(
    private readonly fallback: string,
    private readonly deps: LatestReleaseDeps
  ) {}

  /** This load's release; fixed for the session so one session never mixes releases. Never rejects. */
  current(): Promise<string> {
    this.session ??= this.start();
    return this.session;
  }

  /** `release` is gone from the publisher: asks at once, once per session; the replacement, or null when nothing changed. */
  async gone(release: string): Promise<string | null> {
    if ((await this.current()) !== release || this.redone || !this.deps.online()) return null;
    this.redone = true;
    const next = await this.check(RELEASE_FIRST_TIMEOUT_MS);
    if (!next || next === release) return null;
    this.session = Promise.resolve(next);
    return next;
  }

  private start(): Promise<string> {
    const known = this.deps.memory.get();
    if (known) {
      if (this.deps.online() && this.deps.now() - known.checkedAt > RELEASE_STALE_MS) this.deps.later(() => void this.check(RELEASE_BACKGROUND_TIMEOUT_MS));
      return Promise.resolve(known.release);
    }
    if (!this.deps.online()) return Promise.resolve(this.fallback);
    return this.check(RELEASE_FIRST_TIMEOUT_MS).then((r) => r ?? this.fallback);
  }

  /** Asks the publisher and remembers a usable answer; null on any failure. */
  private async check(timeoutMs: number): Promise<string | null> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await Promise.race([this.deps.check(ctl.signal), new Promise<null>((resolve) => ctl.signal.addEventListener('abort', () => resolve(null)))]);
      if (r) this.deps.memory.set({ release: r, checkedAt: this.deps.now() });
      return r;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A value a worker waits for until the main thread sends it; a later send replaces it. */
export class Handoff<T> {
  private value: Promise<T>;
  private provide: ((v: T) => void) | null = null;

  constructor() {
    this.value = new Promise((resolve) => (this.provide = resolve));
  }

  get(): Promise<T> {
    return this.value;
  }

  set(v: T): void {
    if (this.provide) this.provide(v);
    else this.value = Promise.resolve(v);
    this.provide = null;
  }
}
