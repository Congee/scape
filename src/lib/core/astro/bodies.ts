import { Body, DefineStar, Observer } from 'astronomy-engine';
import type { LngLat } from '@core/geo/geodesy';

export const SkyBody = { Sun: 'Sun', Moon: 'Moon', Gc: 'Gc' } as const;
export type SkyBody = (typeof SkyBody)[keyof typeof SkyBody];

// Sgr A* (J2000), the Galactic Centre, in astronomy-engine's first user star slot.
DefineStar(Body.Star1, 17.76112, -29.00781, 26_000);

export const BODY: Record<SkyBody, Body> = { Sun: Body.Sun, Moon: Body.Moon, Gc: Body.Star1 };

export const BODIES: SkyBody[] = [SkyBody.Sun, SkyBody.Moon, SkyBody.Gc];

export function makeObserver(p: LngLat, heightM = 0): Observer {
  return new Observer(p.lat, p.lng, heightM);
}
