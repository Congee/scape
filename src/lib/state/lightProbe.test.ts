import { describe, expect, it, vi } from 'vitest';
import type { HorizonProfile } from '@core/terrain/horizon';
import { TerrainKind, type HorizonRequest, type HorizonResult, type TerrainResponse } from '@workers/terrain.protocol';
import { WORKER_IDLE_MS } from './idleWorker';
import { lightPointObserver, lightProbeStore } from './lightProbe';
import { EYE_HEIGHT_M } from './terrain';
import { worldStore } from './world';

describe('lightPointObserver', () => {
  it('stands on the point’s ground, or sea level where it is unknown', () => {
    const p = { lat: 46.5475, lng: 7.9625 };
    expect(lightPointObserver(p, { groundM: 3000 }).height).toBe(3000 + EYE_HEIGHT_M);
    expect(lightPointObserver(p, { groundM: Number.NaN }).height).toBe(EYE_HEIGHT_M);
    expect(lightPointObserver(p, { groundM: 3000 }, 31.6).height).toBe(3031.6);
  });
});

const skyline = (deg: number): HorizonProfile => ({ azStepDeg: 90, angleDeg: new Float32Array(4).fill(deg), distM: new Float32Array(4).fill(1000), rangeM: 1000 });
const horizon = (deg: number, refined: boolean): HorizonResult => ({ profile: skyline(deg), groundM: 3000, eyeM: 3000 + EYE_HEIGHT_M, tiles: 1, missing: 0, refined });

describe('lightProbeStore', () => {
  it('lets its worker go once idle and answers the same through a fresh one', () => {
    vi.useFakeTimers();
    const made: { req?: HorizonRequest; onMessage?: (e: { data: TerrainResponse }) => void; terminated: boolean }[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        me = { terminated: false } as (typeof made)[number];
        constructor() {
          made.push(this.me);
        }
        addEventListener(_: string, f: (e: { data: TerrainResponse }) => void) {
          this.me.onMessage = f;
        }
        postMessage(r: HorizonRequest) {
          this.me.req = r;
        }
        terminate() {
          this.me.terminated = true;
        }
      }
    );
    const w = worldStore.getState();
    w.setTz('Europe/Zurich');
    w.setTime(Date.UTC(2026, 5, 21, 11));
    const answer = (i: number, refined: boolean) => made[i].onMessage!({ data: { kind: TerrainKind.Horizon, id: made[i].req!.id, result: horizon(5, refined) } });
    const p = { lat: 46.5475, lng: 7.9625 };
    lightProbeStore.getState().setPoint(p);
    answer(0, false);
    // The coarse skyline is not the end of the request.
    vi.advanceTimersByTime(WORKER_IDLE_MS * 2);
    expect(made[0].terminated).toBe(false);
    answer(0, true);
    const first = lightProbeStore.getState().light;
    vi.advanceTimersByTime(WORKER_IDLE_MS - 1);
    expect(made[0].terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(made[0].terminated).toBe(true);
    lightProbeStore.getState().setPoint(p);
    expect(made).toHaveLength(2);
    answer(1, true);
    expect(lightProbeStore.getState().light).toEqual(first);
    vi.advanceTimersByTime(WORKER_IDLE_MS);
    expect(made[1].terminated).toBe(true);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('recomputes first and last light when the refined skyline replaces the coarse one', () => {
    let onMessage: ((e: { data: TerrainResponse }) => void) | undefined;
    let req: HorizonRequest | undefined;
    vi.stubGlobal(
      'Worker',
      class {
        addEventListener(_: string, f: NonNullable<typeof onMessage>) {
          onMessage = f;
        }
        postMessage(r: HorizonRequest) {
          req = r;
        }
      }
    );
    const w = worldStore.getState();
    w.setTz('Europe/Zurich');
    w.setTime(Date.UTC(2026, 5, 21, 11));
    lightProbeStore.getState().setPoint({ lat: 46.5475, lng: 7.9625 });
    onMessage!({ data: { kind: TerrainKind.Horizon, id: req!.id, result: horizon(0, false) } });
    const coarse = lightProbeStore.getState().light!;
    onMessage!({ data: { kind: TerrainKind.Horizon, id: req!.id, result: horizon(10, true) } });
    const fine = lightProbeStore.getState().light!;
    expect(fine.first).toBeGreaterThan(coarse.first!);
    expect(fine.last).toBeLessThan(coarse.last!);
    vi.unstubAllGlobals();
  });
});
