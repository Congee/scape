import { describe, expect, it } from 'vitest';
import {
  APERTURE_THIRDS,
  apertureFor,
  ev100,
  evAtIso,
  formatShutter,
  isoFor,
  ndOpticalDensity,
  ndShutter,
  ndStops,
  ndStopsFromDensity,
  nearestNominal,
  parseShutter,
  sceneExposure,
  SHUTTER_THIRDS_S,
  shutterFor
} from './exposure';

const stopsApart = (a: number, b: number) => Math.abs(Math.log2(a / b));

describe('EV100', () => {
  it('Wikipedia "Exposure value": EV 0 is f/1 at 1 s, ISO 100', () => {
    expect(ev100(1, 1, 100)).toBe(0);
  });

  it('Wikipedia "Exposure value", sunny 16: f/16, 1/125 s, ISO 100 is EV 15', () => {
    expect(ev100(16, 1 / 125, 100)).toBeCloseTo(15, 1);
    expect(nearestNominal(shutterFor(15, 16, 100), SHUTTER_THIRDS_S)).toBeCloseTo(1 / 125, 6);
  });

  it('solving for each term inverts ev100', () => {
    const ev = ev100(5.6, 1 / 60, 400);
    expect(apertureFor(ev, 1 / 60, 400)).toBeCloseTo(5.6, 9);
    expect(shutterFor(ev, 5.6, 400)).toBeCloseTo(1 / 60, 9);
    expect(isoFor(ev, 5.6, 1 / 60)).toBeCloseTo(400, 6);
    expect(nearestNominal(apertureFor(ev100(8, 1 / 125, 100), 1 / 125, 100), APERTURE_THIRDS)).toBe(8);
  });

  it('Wikipedia "Exposure value" Table 2 note: night sports EV100 9 is EV 11 at ISO 400', () => {
    expect(evAtIso(9, 400)).toBe(11);
  });

  it('Wikipedia "Exposure value" Table 2 note: a rainbow on a cloudy sky is EV 13 at ISO 50', () => {
    const rainbow = sceneExposure({ sunAltDeg: 25, moonAltDeg: -10, moonIllumination: 0 }).find((r) => r.label.startsWith('Rainbow, cloudy'));
    expect(rainbow && evAtIso(rainbow.ev, 50)).toBe(13);
  });
});

describe('shutter labels', () => {
  it('formats and parses camera-style times', () => {
    expect(formatShutter(1 / 250)).toBe('1/250');
    expect(formatShutter(0.6)).toBe('0.6 s');
    expect(formatShutter(30)).toBe('30 s');
    expect(formatShutter(256)).toBe('4 min 16 s');
    expect(parseShutter('1/250')).toBeCloseTo(0.004, 9);
    expect(parseShutter('2"')).toBe(2);
    expect(parseShutter('4m')).toBe(240);
    expect(parseShutter('abc')).toBeNull();
  });
});

describe('ND filters', () => {
  it('B+W / Hoya naming: ND1000 is 10 stops at OD 3.0, ND64 is 6 stops at OD 1.8', () => {
    expect(ndStops(1000)).toBeCloseTo(9.97, 2);
    expect(ndOpticalDensity(ndStops(1000))).toBeCloseTo(3, 9);
    expect(ndStops(64)).toBe(6);
    expect(ndOpticalDensity(6)).toBeCloseTo(1.8, 1);
    expect(ndStopsFromDensity(0.9)).toBeCloseTo(3, 1);
  });

  it('Lee Filters Big Stopper chart (10 stops): 1/30 → 30 s, 1/4 → 4 min, 1 s → 16 min within a third of a stop', () => {
    expect(stopsApart(ndShutter(1 / 30, 10), 30)).toBeLessThan(1 / 3);
    expect(stopsApart(ndShutter(1 / 4, 10), 240)).toBeLessThan(1 / 3);
    expect(stopsApart(ndShutter(1, 10), 960)).toBeLessThan(1 / 3);
  });
});

describe('scene suggestion', () => {
  const none = { moonAltDeg: -20, moonIllumination: 0 };

  it('Wikipedia "Exposure value" Table 2 rows by sun altitude', () => {
    expect(sceneExposure({ sunAltDeg: 45, ...none })[0].ev).toBe(15);
    expect(sceneExposure({ sunAltDeg: 3, ...none })[0].ev).toBe(13);
    expect(sceneExposure({ sunAltDeg: -0.5, ...none })[0].ev).toBe(12);
    expect(sceneExposure({ sunAltDeg: -4, ...none })[0].ev).toBe(10);
    expect(sceneExposure({ sunAltDeg: -30, ...none })[0].ev).toBe(-10);
  });

  it('twilight falls monotonically from civil to astronomical dusk', () => {
    const evs = [-7, -10, -13, -16].map((s) => sceneExposure({ sunAltDeg: s, ...none })[0].ev);
    expect(evs).toEqual(evs.toSorted((a, b) => b - a));
    expect(sceneExposure({ sunAltDeg: -12, ...none })[0].estimate).toBe(true);
  });

  it('Wikipedia "Exposure value" Table 2: full moonlight above 40° is EV −3 to −2, dimmer when low', () => {
    const high = sceneExposure({ sunAltDeg: -30, moonAltDeg: 50, moonIllumination: 1 })[0];
    expect([high.lo, high.hi]).toEqual([-3, -2]);
    const low = sceneExposure({ sunAltDeg: -30, moonAltDeg: 15, moonIllumination: 1 })[0];
    expect(low.ev).toBeLessThan(high.ev);
    expect(low.estimate).toBe(true);
    expect(sceneExposure({ sunAltDeg: -30, moonAltDeg: 50, moonIllumination: 1 }).some((r) => r.label === 'Moon disc, full' && r.ev === 15)).toBe(true);
  });

  it('a lunar eclipse takes its stops off the moonlight and the disc', () => {
    const rows = sceneExposure({ sunAltDeg: -30, moonAltDeg: 50, moonIllumination: 1, moonEclipse: 2 ** -12 });
    const disc = rows.find((r) => r.label === 'Moon disc, full, eclipsed');
    expect(disc?.ev).toBe(3);
    // Totality's moonlight sinks under the Milky Way row.
    expect(rows[0].label).toBe('Starlight, Milky Way core');
    const pen = sceneExposure({ sunAltDeg: -30, moonAltDeg: 50, moonIllumination: 1, moonEclipse: 0.5 })[0];
    expect([pen.lo, pen.hi]).toEqual([-4, -3]);
    expect(pen.label).toBe('Full moonlight, eclipsed');
  });

  it('no rainbow row once the sun is above 42°', () => {
    expect(sceneExposure({ sunAltDeg: 50, ...none }).some((r) => r.label.startsWith('Rainbow'))).toBe(false);
  });
});

describe('PlanIt exposure guide', () => {
  const none = { moonAltDeg: -20, moonIllumination: 0 };

  it('an EV 15 scene shot at 1/250 s, f/8, ISO 100 is 1 stop over', () => {
    expect(15 - ev100(8, 1 / 250, 100)).toBeCloseTo(1, 1);
  });

  it('Sunny 16: f/16, 1/100 s, ISO 100 is EV 14.6', () => {
    expect(ev100(16, 1 / 100, 100)).toBeCloseTo(14.6, 1);
  });

  it('Looney 11, 8, 5.6: full, gibbous and crescent moon at 1/100 s, ISO 100', () => {
    expect(ev100(11, 1 / 100, 100)).toBeCloseTo(13.6, 1);
    expect(ev100(8, 1 / 100, 100)).toBeCloseTo(12.6, 1);
    expect(ev100(5.6, 1 / 100, 100)).toBeCloseTo(11.6, 1);
  });

  it('night skyline rule: 30 s, f/8, ISO 100 is EV 1', () => {
    expect(ev100(8, 30, 100)).toBeCloseTo(1, 0);
  });

  it('Milky Way rule: 30 s, f/2.8, ISO 3200 is EV −6.9; Scape tabulates the core 3 stops darker', () => {
    const mw = ev100(2.8, 30, 3200);
    expect(mw).toBeCloseTo(-6.9, 1);
    expect(mw - sceneExposure({ sunAltDeg: -30, ...none })[0].ev).toBeCloseTo(3.1, 1);
  });

  it('scene mode, a clear day at daytime: EV 15', () => {
    expect(sceneExposure({ sunAltDeg: 45, ...none })[0].ev).toBe(15);
  });

  it('scene mode, the moon as the subject: EV 14; Scape tabulates the full disc a stop brighter', () => {
    const disc = sceneExposure({ sunAltDeg: -30, moonAltDeg: 50, moonIllumination: 1 }).find((r) => r.label === 'Moon disc, full');
    expect(disc?.ev).toBe(14 + 1);
  });

  it('scene mode, a clear dark night: EV −6; Scape tabulates −10, the 0.002 lux of a moonless sky', () => {
    expect(sceneExposure({ sunAltDeg: -30, ...none })[0].ev).toBe(-6 - 4);
    expect(Math.log2((0.002 * 100) / 250)).toBeCloseTo(-10.3, 1);
  });

  it('scene mode, sunset EV 5.5 and the start of the blue hour EV 1.6: Scape reads the sunset-sky rows, 6–8 stops brighter', () => {
    expect(sceneExposure({ sunAltDeg: -0.5, ...none })[0].ev - 5.5).toBe(6.5);
    expect(sceneExposure({ sunAltDeg: -4, ...none })[0].ev - 1.6).toBeCloseTo(8.4, 9);
  });
});
