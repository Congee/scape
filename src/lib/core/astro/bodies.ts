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

/** Observer height above sea level for a site; unknown ground is sea level, and astronomy-engine's atmosphere stops at −500 m. */
export function siteHeightM(groundM: number | null, aboveGroundM: number): number {
  const g = groundM === null || Number.isNaN(groundM) ? 0 : Math.max(groundM, -500);
  return g + aboveGroundM;
}

/** SearchRiseSet refracts in the air at `height − aboveGroundM`; lifting the eye by that much puts it at the eye. */
export function riseSetObserver(eye: Observer, aboveGroundM: number): Observer {
  return new Observer(eye.latitude, eye.longitude, eye.height + aboveGroundM);
}
