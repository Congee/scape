import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Handoff, LatestRelease, RELEASE_FIRST_TIMEOUT_MS, RELEASE_STALE_MS, type KnownRelease } from './latestRelease';

const DAY = 24 * 3600_000;
const T0 = 1_800_000_000_000;

function setup(opts: { remembered?: KnownRelease; online?: boolean; answer?: (signal: AbortSignal) => Promise<string | null> } = {}) {
  let stored: KnownRelease | null = opts.remembered ?? null;
  let clock = T0;
  const online = { value: opts.online ?? true };
  const deferred: (() => void)[] = [];
  const check = vi.fn(opts.answer ?? (async () => 'v2'));
  const r = new LatestRelease('v0', {
    check,
    memory: { get: () => stored, set: (k) => (stored = k) },
    now: () => clock,
    online: () => online.value,
    later: (run) => deferred.push(run)
  });
  return { r, check, deferred, online, stored: () => stored, tick: (ms: number) => (clock += ms) };
}

describe('LatestRelease', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('serves a fresh remembered release without asking', async () => {
    const s = setup({ remembered: { release: 'v1', checkedAt: T0 - DAY } });
    expect(await s.r.current()).toBe('v1');
    expect(s.deferred).toHaveLength(0);
    expect(s.check).not.toHaveBeenCalled();
  });

  it('serves a stale remembered release at once and re-checks it later, for the next load', async () => {
    const s = setup({ remembered: { release: 'v1', checkedAt: T0 - RELEASE_STALE_MS - 1 } });
    expect(await s.r.current()).toBe('v1');
    expect(s.check).not.toHaveBeenCalled();
    s.deferred[0]();
    await vi.runAllTimersAsync();
    expect(s.stored()).toEqual({ release: 'v2', checkedAt: T0 });
    expect(await s.r.current()).toBe('v1');
  });

  it('keeps the remembered release when the background check fails', async () => {
    const s = setup({ remembered: { release: 'v1', checkedAt: 0 }, answer: () => Promise.reject(new TypeError('Failed to fetch')) });
    await s.r.current();
    s.deferred[0]();
    await vi.runAllTimersAsync();
    expect(s.stored()).toEqual({ release: 'v1', checkedAt: 0 });
  });

  it('asks on a first load and remembers the answer', async () => {
    const s = setup();
    expect(await s.r.current()).toBe('v2');
    expect(s.stored()).toEqual({ release: 'v2', checkedAt: T0 });
    expect(s.check).toHaveBeenCalledTimes(1);
  });

  it('falls back when a first load times out, aborting the request', async () => {
    let signal: AbortSignal | undefined;
    const s = setup({ answer: (sig) => ((signal = sig), new Promise(() => {})) });
    const p = s.r.current();
    await vi.advanceTimersByTimeAsync(RELEASE_FIRST_TIMEOUT_MS);
    expect(await p).toBe('v0');
    expect(signal?.aborted).toBe(true);
    expect(s.stored()).toBeNull();
  });

  it('falls back on an unusable answer', async () => {
    expect(await setup({ answer: async () => null }).r.current()).toBe('v0');
  });

  it('never waits on the network offline', async () => {
    const s = setup({ online: false });
    expect(await s.r.current()).toBe('v0');
    const stale = setup({ online: false, remembered: { release: 'v1', checkedAt: 0 } });
    expect(await stale.r.current()).toBe('v1');
    expect(stale.deferred).toHaveLength(0);
    expect(s.check).not.toHaveBeenCalled();
  });

  it('re-resolves a remembered release that is gone, at once and only once', async () => {
    const s = setup({ remembered: { release: 'v1', checkedAt: T0 } });
    await s.r.current();
    expect(await s.r.gone('v1')).toBe('v2');
    expect(await s.r.current()).toBe('v2');
    expect(s.stored()).toEqual({ release: 'v2', checkedAt: T0 });
    expect(await s.r.gone('v2')).toBeNull();
    expect(s.check).toHaveBeenCalledTimes(1);
  });

  it('ignores a gone report for another release, offline, or with no newer answer', async () => {
    const s = setup({ remembered: { release: 'v1', checkedAt: T0 } });
    expect(await s.r.gone('v9')).toBeNull();
    s.online.value = false;
    expect(await s.r.gone('v1')).toBeNull();
    expect(s.check).not.toHaveBeenCalled();
    const same = setup({ remembered: { release: 'v2', checkedAt: T0 } });
    expect(await same.r.gone('v2')).toBeNull();
    expect(await same.r.current()).toBe('v2');
  });
});

describe('Handoff', () => {
  it('waits for the first value and takes later ones', async () => {
    const h = new Handoff<string>();
    let got = '';
    void h.get().then((v) => (got = v));
    await Promise.resolve();
    expect(got).toBe('');
    h.set('a');
    expect(await h.get()).toBe('a');
    h.set('b');
    expect(await h.get()).toBe('b');
  });
});
