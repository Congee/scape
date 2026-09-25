import { describe, expect, it } from 'vitest';
import { fetchFault, httpFault, Lod2Failures, Lod2Fault, LOD2_RETRY_MAX_MS, LOD2_RETRY_MS } from './failures';

describe('httpFault', () => {
  it('treats absent and refused content as permanent', () => {
    for (const s of [400, 401, 403, 404, 410]) expect(httpFault(s)).toBe(Lod2Fault.Permanent);
  });

  it('retries timeouts, rate limits and server errors', () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504]) expect(httpFault(s)).toBe(Lod2Fault.Transient);
  });
});

describe('fetchFault', () => {
  it('tells an abort from a network failure', () => {
    expect(fetchFault(new DOMException('gone', 'AbortError'))).toBe(Lod2Fault.Abort);
    expect(fetchFault(new TypeError('Failed to fetch'))).toBe(Lod2Fault.Transient);
    expect(fetchFault('odd')).toBe(Lod2Fault.Transient);
  });
});

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('Lod2Failures', () => {
  it('warns once for a permanent failure and blocks it for good', () => {
    const c = clock();
    const f = new Lod2Failures(c.now);
    expect(f.blocked('a')).toBe(false);
    expect(f.record('a', Lod2Fault.Permanent)).toBe(true);
    expect(f.record('a', Lod2Fault.Permanent)).toBe(false);
    c.advance(1e9);
    expect(f.blocked('a')).toBe(true);
  });

  it('retries a transient failure after a doubling backoff, warning only the first time', () => {
    const c = clock();
    const f = new Lod2Failures(c.now);
    expect(f.record('a', Lod2Fault.Transient)).toBe(true);
    c.advance(LOD2_RETRY_MS - 1);
    expect(f.blocked('a')).toBe(true);
    c.advance(1);
    expect(f.blocked('a')).toBe(false);
    expect(f.record('a', Lod2Fault.Transient)).toBe(false);
    c.advance(2 * LOD2_RETRY_MS - 1);
    expect(f.blocked('a')).toBe(true);
    c.advance(1);
    expect(f.blocked('a')).toBe(false);
  });

  it('caps the backoff', () => {
    const c = clock();
    const f = new Lod2Failures(c.now);
    for (let i = 0; i < 20; i++) f.record('a', Lod2Fault.Transient);
    c.advance(LOD2_RETRY_MAX_MS);
    expect(f.blocked('a')).toBe(false);
  });

  it('forgets a transient failure once the URL succeeds, but still warns no more', () => {
    const f = new Lod2Failures(() => 0);
    f.record('a', Lod2Fault.Transient);
    f.succeeded('a');
    expect(f.blocked('a')).toBe(false);
    expect(f.record('a', Lod2Fault.Transient)).toBe(false);
  });

  it('neither warns nor blocks on an abort', () => {
    const f = new Lod2Failures(() => 0);
    expect(f.record('a', Lod2Fault.Abort)).toBe(false);
    expect(f.blocked('a')).toBe(false);
    expect(f.record('a', Lod2Fault.Transient)).toBe(true);
  });

  it('keeps URLs apart', () => {
    const f = new Lod2Failures(() => 0);
    f.record('a', Lod2Fault.Permanent);
    expect(f.blocked('b')).toBe(false);
    expect(f.record('b', Lod2Fault.Permanent)).toBe(true);
  });
});
