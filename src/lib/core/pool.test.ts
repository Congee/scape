import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferPool, IdleRelease, POOL_IDLE_RELEASE_MS, poolSize } from './pool';

describe('BufferPool', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hands a returned buffer to the next rebuild', () => {
    const p = new BufferPool();
    const a = p.f32(1000);
    p.give(a.buffer);
    const b = p.f32(900);
    expect(b.buffer).toBe(a.buffer);
    expect(b.length).toBe(900);
    expect(p.size).toBe(0);
  });

  it('picks the tightest fit and grows past the largest seen', () => {
    const p = new BufferPool();
    const small = p.take(10_000);
    const big = p.take(100_000);
    p.give(big);
    p.give(small);
    expect(p.take(9000)).toBe(small);
    const bigger = p.take(200_000);
    expect(bigger).not.toBe(big);
    expect(bigger.byteLength).toBeGreaterThanOrEqual(200_000);
    expect(p.take(100_000)).toBe(big);
  });

  it('ignores a detached or doubly returned buffer', () => {
    const p = new BufferPool();
    const a = p.take(4096);
    p.give(a);
    p.give(a);
    expect(p.size).toBe(1);
    const b = p.take(4096);
    structuredClone(b, { transfer: [b] });
    p.give(b);
    expect(p.size).toBe(0);
  });

  it('lets go of its buffers after the idle constant, and allocates afresh afterwards', () => {
    const p = new BufferPool();
    const a = p.take(4096);
    p.give(a);
    vi.advanceTimersByTime(POOL_IDLE_RELEASE_MS - 1);
    expect(p.size).toBe(1);
    // Use re-arms the one timer.
    p.give(p.take(4096));
    vi.advanceTimersByTime(POOL_IDLE_RELEASE_MS - 1);
    expect(p.size).toBe(1);
    vi.advanceTimersByTime(1);
    expect(p.size).toBe(0);
    expect(p.bytes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const b = p.take(4096);
    expect(b).not.toBe(a);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('IdleRelease', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps one timer however often it is touched, and none once cancelled', () => {
    const release = vi.fn();
    const r = new IdleRelease(release, 1000);
    for (let i = 0; i < 5; i++) r.touch();
    expect(vi.getTimerCount()).toBe(1);
    r.cancel();
    vi.advanceTimersByTime(2000);
    expect(release).not.toHaveBeenCalled();
    r.touch();
    vi.advanceTimersByTime(1000);
    expect(release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('poolSize', () => {
  it('rounds up by at most a quarter', () => {
    for (const n of [1025, 5000, 65_536, 65_537, 3_000_001]) {
      expect(poolSize(n)).toBeGreaterThanOrEqual(n);
      expect(poolSize(n)).toBeLessThanOrEqual(n * 1.25);
    }
    expect(poolSize(10)).toBe(1024);
  });
});
