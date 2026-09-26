/**
 * Tiles a worker posted, numbered, so a request built before the caller read them can count them
 * as held instead of building them again; a request names the newest number its caller had read.
 */
export class InFlight {
  private n = 0;
  /** In posting order, so everything read sits at the front. */
  private readonly sent = new Map<string, { sig: string; n: number }>();

  /** Numbers a tile about to be posted. */
  post(key: string, sig: string): number {
    this.n++;
    this.sent.delete(key);
    this.sent.set(key, { sig, n: this.n });
    return this.n;
  }

  /** Forgets the tiles the caller has read, up to `seen`. */
  read(seen: number): void {
    for (const [key, s] of this.sent) {
      if (s.n > seen) break;
      this.sent.delete(key);
    }
  }

  /** True when `key` built for `sig` is still on its way to the caller. */
  pending(key: string, sig: string): boolean {
    return this.sent.get(key)?.sig === sig;
  }
}
