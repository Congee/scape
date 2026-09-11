import type { Observer } from 'astronomy-engine';
import { BODIES, type SkyBody } from './bodies';
import { position } from './positions';

export interface DayCurve {
  startMs: number;
  stepMs: number;
  /** Sample count; sample i is at startMs + i * stepMs, the last one lands on endMs. */
  n: number;
  altitude: Record<SkyBody, Float32Array>;
  azimuth: Record<SkyBody, Float32Array>;
}

/** Altitude/azimuth of each body sampled across a local day. Meant to run in a worker. */
export function dayCurve(obs: Observer, startMs: number, endMs: number, stepMs = 5 * 60_000): DayCurve {
  const n = Math.floor((endMs - startMs) / stepMs) + 1;
  const altitude = {} as Record<SkyBody, Float32Array>;
  const azimuth = {} as Record<SkyBody, Float32Array>;
  for (const b of BODIES) {
    altitude[b] = new Float32Array(n);
    azimuth[b] = new Float32Array(n);
  }
  for (let i = 0; i < n; i++) {
    const date = new Date(startMs + i * stepMs);
    for (const b of BODIES) {
      const p = position(b, date, obs);
      altitude[b][i] = p.altitude;
      azimuth[b][i] = p.azimuth;
    }
  }
  return { startMs, stepMs, n, altitude, azimuth };
}
