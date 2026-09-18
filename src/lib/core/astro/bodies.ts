import { Body, DefineStar, Observer } from 'astronomy-engine';
import type { LngLat } from '@core/geo/geodesy';

export const SkyBody = { Sun: 'Sun', Moon: 'Moon', Gc: 'Gc' } as const;
export type SkyBody = (typeof SkyBody)[keyof typeof SkyBody];

// Sgr A* (J2000), the Galactic Centre, and Polaris in astronomy-engine's user star slots.
DefineStar(Body.Star1, 17.76112, -29.00781, 26_000);
DefineStar(Body.Star2, 2.530301, 89.264109, 433);
export const POLARIS_BODY = Body.Star2;

export const BODY: Record<SkyBody, Body> = { Sun: Body.Sun, Moon: Body.Moon, Gc: Body.Star1 };

export const BODIES: SkyBody[] = [SkyBody.Sun, SkyBody.Moon, SkyBody.Gc];

/** Master switch per body, shared by the disc, label and path passes. */
export function bodyVisible(b: SkyBody, c: { showSun: boolean; showMoon: boolean }, s: { showGc: boolean }): boolean {
  if (b === SkyBody.Sun) return c.showSun;
  if (b === SkyBody.Moon) return c.showMoon;
  return s.showGc;
}

export function makeObserver(p: LngLat, heightM = 0): Observer {
  return new Observer(p.lat, p.lng, heightM);
}
