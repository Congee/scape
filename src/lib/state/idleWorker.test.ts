import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdleWorker } from './idleWorker';

class FakeWorker {
  static made: FakeWorker[] = [];
  sent: unknown[] = [];
  terminated = false;
  onMessage: ((e: { data: unknown }) => void) | undefined;
  constructor() {
    FakeWorker.made.push(this);
  }
  addEventListener(_: string, f: (e: { data: unknown }) => void) {
    this.onMessage = f;
  }
  postMessage(m: unknown) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
}

const IDLE = 1000;
const make = () => {
  const got: unknown[] = [];
  const w = new IdleWorker<number, string>(() => new FakeWorker() as unknown as Worker, (m) => got.push(m), IDLE);
  return { w, got };
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.made = [];
});
afterEach(() => vi.useRealTimers());

describe('IdleWorker', () => {
  it('spawns on the first post and passes answers to the owner', () => {
    const { w, got } = make();
    expect(w.alive).toBe(false);
    w.post(1);
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0].sent).toEqual([1]);
    FakeWorker.made[0].onMessage!({ data: 'a' });
    expect(got).toEqual(['a']);
  });

  it('never terminates while a request is in flight', () => {
    const { w } = make();
    w.post(1);
    vi.advanceTimersByTime(IDLE * 100);
    expect(w.alive).toBe(true);
    expect(FakeWorker.made[0].terminated).toBe(false);
  });

  it('terminates the idle span after the owner settles', () => {
    const { w } = make();
    w.post(1);
    w.settle();
    vi.advanceTimersByTime(IDLE - 1);
    expect(w.alive).toBe(true);
    vi.advanceTimersByTime(1);
    expect(w.alive).toBe(false);
    expect(FakeWorker.made[0].terminated).toBe(true);
  });

  it('keeps the worker when a request comes inside the span', () => {
    const { w } = make();
    w.post(1);
    w.settle();
    vi.advanceTimersByTime(IDLE - 1);
    w.post(2);
    vi.advanceTimersByTime(IDLE * 10);
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0].sent).toEqual([1, 2]);
    expect(w.alive).toBe(true);
  });

  it('spawns a fresh worker for a request after termination', () => {
    const { w, got } = make();
    w.post(1);
    w.settle();
    vi.advanceTimersByTime(IDLE);
    w.post(2);
    expect(FakeWorker.made).toHaveLength(2);
    expect(FakeWorker.made[1].sent).toEqual([2]);
    FakeWorker.made[1].onMessage!({ data: 'b' });
    expect(got).toEqual(['b']);
  });

  it('settling with no worker arms nothing', () => {
    const { w } = make();
    w.settle();
    expect(vi.getTimerCount()).toBe(0);
  });
});
