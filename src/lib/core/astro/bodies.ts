import { Body, DefineStar, Observer } from 'astronomy-engine';
import type { LngLat } from '@core/geo/geodesy';

export type SkyBody = 'sun' | 'moon' | 'gc';

// Sgr A* (J2000), the Galactic Centre, in astronomy-engine's first user star slot.
DefineStar(Body.Star1, 17.76112, -29.00781, 26_000);

export const BODY: Record<SkyBody, Body> = { sun: Body.Sun, moon: Body.Moon, gc: Body.Star1 };

export const BODIES: SkyBody[] = ['sun', 'moon', 'gc'];

export function makeObserver(p: LngLat, heightM = 0): Observer {
  return new Observer(p.lat, p.lng, heightM);
}
