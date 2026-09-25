/** How a failed LoD2 fetch is treated on the next request for the same URL. */
export const Lod2Fault = {
  /** Absent or undecodable: skipped for the worker's lifetime. */
  Permanent: 'Permanent',
  /** Network, server or rate limit: retried after a growing backoff. */
  Transient: 'Transient',
  /** Superseded by its caller: neither warned nor remembered. */
  Abort: 'Abort'
} as const;
export type Lod2Fault = (typeof Lod2Fault)[keyof typeof Lod2Fault];

/** 404 and other client errors will not change on a retry; timeouts, rate limits and 5xx may. */
export function httpFault(status: number): Lod2Fault {
  return status >= 500 || status === 408 || status === 425 || status === 429 ? Lod2Fault.Transient : Lod2Fault.Permanent;
}

/** A throw from fetch or reading its body: only an abort is not the network's doing. */
export function fetchFault(err: unknown): Lod2Fault {
  return err instanceof Error && err.name === 'AbortError' ? Lod2Fault.Abort : Lod2Fault.Transient;
}

export const LOD2_RETRY_MS = 30_000;
export const LOD2_RETRY_MAX_MS = 15 * 60_000;

type Entry = { fault: Lod2Fault; tries: number; retryAt: number };

/** Failed LoD2 URLs, so a known-bad one costs no fetch or decode and warns once. */
export class Lod2Failures {
  private entries = new Map<string, Entry>();
  private warned = new Set<string>();

  constructor(private now: () => number) {}

  /** True while `url` must not be fetched. */
  blocked(url: string): boolean {
    const e = this.entries.get(url);
    return !!e && (e.fault === Lod2Fault.Permanent || this.now() < e.retryAt);
  }

  /** Records a failure; true when it is the first for `url` worth a warning. */
  record(url: string, fault: Lod2Fault): boolean {
    if (fault === Lod2Fault.Abort) return false;
    const tries = (this.entries.get(url)?.tries ?? 0) + 1;
    const retryAt = this.now() + Math.min(LOD2_RETRY_MS * 2 ** (tries - 1), LOD2_RETRY_MAX_MS);
    this.entries.set(url, { fault, tries, retryAt });
    if (this.warned.has(url)) return false;
    this.warned.add(url);
    return true;
  }

  succeeded(url: string): void {
    this.entries.delete(url);
  }
}
