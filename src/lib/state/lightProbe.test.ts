import { describe, expect, it, vi } from 'vitest';
import type { HorizonProfile } from '@core/terrain/horizon';
import { TerrainKind, type HorizonRequest, type HorizonResult, type TerrainResponse } from '@workers/terrain.protocol';
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
