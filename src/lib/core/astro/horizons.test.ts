import { describe, expect, it } from 'vitest';
import { makeObserver, SkyBody } from './bodies';
import { dayEvents, EventKind } from './dayEvents';
import { position } from './positions';

// Reference values from JPL Horizons observer tables (apparent, REFRACTED; events from AIRLESS upper limb at −34′).
const D2R = Math.PI / 180;
const sepDeg = (az1: number, el1: number, az2: number, el2: number) =>
  Math.acos(Math.min(1, Math.sin(el1 * D2R) * Math.sin(el2 * D2R) + Math.cos(el1 * D2R) * Math.cos(el2 * D2R) * Math.cos((az1 - az2) * D2R))) / D2R;

describe('position vs JPL Horizons', () => {
  it.each([
    ['Gornergrat sun', SkyBody.Sun, 45.9837, 7.7847, 3089, '2024-06-21T15:00:00Z', 260.065134, 42.542062],
    ['Cape Town sun', SkyBody.Sun, -33.9249, 18.4241, 10, '2001-03-20T08:00:00Z', 59.57438, 37.127407],
    ['Tromsø moon', SkyBody.Moon, 69.6492, 18.9553, 10, '2026-09-24T21:00:00Z', 176.955081, 12.264838],
    ['Quito moon', SkyBody.Moon, -0.2201, -78.5123, 2850, '2012-12-21T20:00:00Z', 78.509771, 24.92547]
  ] as const)('%s within 0.01°', (_, body, lat, lng, h, iso, az, el) => {
    const p = position(body, new Date(iso), makeObserver({ lat, lng }, h));
    expect(sepDeg(p.azimuth, p.altitude, az, el)).toBeLessThan(0.01);
  });
});

describe('rise/set vs JPL Horizons', () => {
  it.each([
    ['Queenstown sunrise', SkyBody.Sun, EventKind.Rise, -45.0312, 168.6626, '2031-11-13T17:08:14.977Z'],
    ['Queenstown sunset', SkyBody.Sun, EventKind.Set, -45.0312, 168.6626, '2031-11-14T07:51:48.711Z'],
    ['Tromsø moonrise', SkyBody.Moon, EventKind.Rise, 69.6492, 18.9553, '2026-09-24T16:38:07.964Z'],
    ['Tromsø moonset', SkyBody.Moon, EventKind.Set, 69.6492, 18.9553, '2026-09-24T00:10:53.667Z']
  ] as const)('%s within 5 s', (_, body, kind, lat, lng, iso) => {
    const t = Date.parse(iso);
    const ev = dayEvents(makeObserver({ lat, lng }), t - 6 * 3600e3, t + 6 * 3600e3).find((e) => e.body === body && e.kind === kind);
    expect(ev).toBeDefined();
    expect(Math.abs(ev!.time - t)).toBeLessThan(5000);
  });
});
