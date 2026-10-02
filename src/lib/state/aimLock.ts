import { makeObserver, SkyBody } from '@core/astro/bodies';
import { position } from '@core/astro/positions';
import type { LngLat } from '@core/geo/geodesy';
import { AimLock, clampElevation, compositionStore, type Composition } from './composition';
import { pinSiteHeightM, terrainStore } from './terrain';
import { worldStore } from './world';

const BODY_LOCKS: Partial<Record<AimLock, SkyBody>> = { [AimLock.Sun]: SkyBody.Sun, [AimLock.Moon]: SkyBody.Moon, [AimLock.Gc]: SkyBody.Gc };

/** The angles a body lock points at, at its true altitude; null for Target and Free. */
export function bodyAim(lock: AimLock, time: number, pin: LngLat, siteHeightM: number): Pick<Composition, 'azimuthDeg' | 'elevationDeg'> | null {
  const body = BODY_LOCKS[lock];
  if (!body) return null;
  const p = position(body, new Date(time), makeObserver(pin, siteHeightM));
  return { azimuthDeg: p.azimuth, elevationDeg: clampElevation(p.altitude) };
}

function follow() {
  const c = compositionStore.getState();
  const w = worldStore.getState();
  const a = bodyAim(c.aimLock, w.time, w.pin, pinSiteHeightM(w, terrainStore.getState()));
  if (a && (a.azimuthDeg !== c.azimuthDeg || a.elevationDeg !== c.elevationDeg)) compositionStore.setState(a);
}

/** Keeps a sun, moon or GC lock centred as the clock, the camera pin or its ground height change. */
export function startAimFollow(): () => void {
  follow();
  const offs = [
    worldStore.subscribe((s, p) => (s.time !== p.time || s.pin !== p.pin || s.pinHeightM !== p.pinHeightM) && follow()),
    compositionStore.subscribe((s) => s.aimLock, follow),
    terrainStore.subscribe((s) => s.pinGroundM, follow)
  ];
  return () => offs.forEach((off) => off());
}
