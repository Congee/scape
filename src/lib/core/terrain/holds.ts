/** Refcounted eviction holds for a tile cache, and the eviction choice itself. Pure: no cache, no I/O. */

export interface HeldKeys {
  has(key: string): boolean;
}

/**
 * Keys a cache should drop, oldest first, skipping the ones a caller is part-way through reading.
 * Returns fewer than `excess` when too much is held, so the cache is allowed to overshoot rather
 * than drop a tile out from under a reader.
 */
export function evictionKeys(order: Iterable<string>, held: HeldKeys, excess: number): string[] {
  const out: string[] = [];
  if (excess <= 0) return out;
  for (const key of order) {
    if (held.has(key)) continue;
    out.push(key);
    if (out.length >= excess) break;
  }
  return out;
}

/**
 * Keys pinned against eviction while a caller reads them. Refcounted, because several requests can
 * want the same tile at once, and each `retain` hands back its own release.
 */
export class Holds implements HeldKeys {
  private counts = new Map<string, number>();

  has(key: string): boolean {
    return this.counts.has(key);
  }

  get size(): number {
    return this.counts.size;
  }

  /** The release is idempotent, so a `finally` that runs after an early return cannot over-decrement. */
  retain(keys: Iterable<string>): () => void {
    const taken = [...keys];
    for (const k of taken) this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      for (const k of taken) {
        const n = (this.counts.get(k) ?? 0) - 1;
        if (n > 0) this.counts.set(k, n);
        else this.counts.delete(k);
      }
    };
  }
}
