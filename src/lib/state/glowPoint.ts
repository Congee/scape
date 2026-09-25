import type { LngLat } from '@core/geo/geodesy';
import { TerrainKind, type HorizonResult, type TerrainResponse } from '@workers/terrain.protocol';
import type { Settings } from './settings';
import { EYE_HEIGHT_M, HORIZON_AZ_STEP_DEG, horizonKeyFor } from './terrain';
import type { WorldState } from './world';

export const GlowAt = { Target: 'Target', Pin: 'Pin' } as const;
export type GlowAt = (typeof GlowAt)[keyof typeof GlowAt];

export interface GlowPoint {
  at: GlowAt;
  point: LngLat;
  /** Eye over the point's ground the glow is judged from. */
  aboveGroundM: number;
  /** Identity of the skyline it needs; empty when terrain or the horizon is off. */
  horizonKey: string;
}

/** The alpenglow forecast follows the target (the peak being shot), else the camera pin. */
export function glowPointFor(w: Pick<WorldState, 'pin' | 'pinHeightM' | 'pin2'>, s: Pick<Settings, 'terrain' | 'terrainHorizon' | 'horizonRangeKm'>): GlowPoint {
  const one = (p: LngLat, heightM: number) => horizonKeyFor({ pin: p, pinHeightM: heightM, pin2: null, pin2HeightM: 0 }, s);
  if (w.pin2) return { at: GlowAt.Target, point: w.pin2, aboveGroundM: EYE_HEIGHT_M, horizonKey: one(w.pin2, 0) };
  return { at: GlowAt.Pin, point: w.pin, aboveGroundM: w.pinHeightM + EYE_HEIGHT_M, horizonKey: one(w.pin, w.pinHeightM) };
}

let worker: Worker | null = null;
let seq = 0;
let listener: ((r: TerrainResponse) => void) | null = null;

/** Sweeps the skyline at a point off the camera; each call supersedes the last. Returns a cancel. */
export function sweepPointHorizon(point: LngLat, eyeAboveGroundM: number, rangeM: number, on: (r: HorizonResult | Error) => void): () => void {
  if (!worker) {
    worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<TerrainResponse>) => listener?.(e.data));
  }
  const id = ++seq;
  const mine = (r: TerrainResponse) => {
    if (r.id !== id) return;
    if (r.kind === 'Error') on(new Error(r.error));
    else if (r.kind === TerrainKind.Horizon) on(r.result);
  };
  listener = mine;
  worker.postMessage({ kind: TerrainKind.Horizon, id, pin: point, eyeAboveGroundM, rangeM, azStepDeg: HORIZON_AZ_STEP_DEG });
  return () => {
    if (listener === mine) listener = null;
  };
}
