import { describe, expect, it } from 'vitest';
import { Orientation, Teleconverter } from '@core/optics/fov';
import { formatInstant, formatPoint, mapSearchFor, orientationFor, parseInstant, parseNumber, parsePoint, teleconvertersFor, validateScene, viewfinderSearchFor, type SceneWorld } from './urlState';

const HOBOKEN = { lat: 40.747952, lng: -74.023685 };
const EDGE = { lat: 40.753918, lng: -74.000996 };
const TIME = Date.parse('2026-10-26T23:01:25Z');

const world = (over: Partial<SceneWorld> = {}): SceneWorld => ({ pin: HOBOKEN, pin2: EDGE, time: TIME, live: false, tz: 'America/New_York', tzAuto: false, ...over });

describe('urlState', () => {
  it('rounds points to five decimals and parses them back', () => {
    expect(formatPoint(HOBOKEN)).toBe('40.74795,-74.02369');
    expect(parsePoint(formatPoint(HOBOKEN))).toEqual({ lat: 40.74795, lng: -74.02369 });
    // Trailing zeros are dropped to keep the URL short.
    expect(formatPoint({ lat: 40.5, lng: -74 })).toBe('40.5,-74');
  });

  it('rejects junk points', () => {
    for (const junk of ['', 'abc', '40.7', '40.7,', ',-74', '40.7,-74,11', '91,0', '-91,0', '0,181', 'NaN,0', '40.7;-74', 12, null, undefined]) {
      expect(parsePoint(junk)).toBeNull();
    }
  });

  it('formats the time to the ISO minute in UTC and parses it back', () => {
    expect(formatInstant(TIME)).toBe('2026-10-26T23:01Z');
    expect(parseInstant('2026-10-26T23:01Z')).toBe(Date.parse('2026-10-26T23:01:00Z'));
    expect(parseInstant('yesterday')).toBeNull();
    expect(parseInstant(7)).toBeNull();
  });

  it('bounds numbers', () => {
    expect(parseNumber('11.25', 0, 24)).toBe(11.25);
    expect(parseNumber(11.25, 0, 24)).toBe(11.25);
    expect(parseNumber('25', 0, 24)).toBeNull();
    expect(parseNumber('', 0, 24)).toBeNull();
    expect(parseNumber('z', 0, 24)).toBeNull();
  });

  it('round-trips the map search', () => {
    const s = mapSearchFor(world(), 14.567);
    expect(s).toEqual({ camera: '40.74795,-74.02369', target: '40.75392,-74.001', z: 14.57, t: '2026-10-26T23:01Z', tz: 'America/New_York' });
    const back = validateScene(s as Record<string, unknown>);
    expect(parsePoint(back.camera)).toEqual({ lat: 40.74795, lng: -74.02369 });
    expect(parsePoint(back.target)).toEqual({ lat: 40.75392, lng: -74.001 });
    expect(back.z).toBe(14.57);
    expect(parseInstant(back.t)).toBe(Date.parse('2026-10-26T23:01:00Z'));
    expect(back.tz).toBe('America/New_York');
  });

  it('omits the target, the time while live and the zone while automatic', () => {
    const s = mapSearchFor(world({ pin2: null, live: true, tzAuto: true }), 11);
    expect(s).toEqual({ camera: '40.74795,-74.02369', target: undefined, t: undefined, tz: undefined, z: 11 });
  });

  it('round-trips the viewfinder search', () => {
    const s = viewfinderSearchFor(world(), { focalMm: 135.25, orientation: Orientation.Portrait, teleconverters: [] });
    expect(s.f).toBe(135.3);
    expect(s.o).toBe('p');
    expect(s.z).toBeUndefined();
    expect(orientationFor(validateScene(s as Record<string, unknown>).o)).toBe(Orientation.Portrait);
    const land = viewfinderSearchFor(world(), { focalMm: 35, orientation: Orientation.Landscape, teleconverters: [] });
    expect(land.o).toBeUndefined();
    expect(orientationFor(undefined)).toBe(Orientation.Landscape);
  });

  it('round-trips a teleconverter stack and reads a link made before it existed', () => {
    const s = viewfinderSearchFor(world(), { focalMm: 600, orientation: Orientation.Landscape, teleconverters: [Teleconverter.X14, Teleconverter.X20] });
    expect(s.tc).toBe('1.4,2');
    expect(teleconvertersFor(validateScene(s as Record<string, unknown>).tc)).toEqual([Teleconverter.X14, Teleconverter.X20]);
    // A link from before stacking carried one bare number.
    expect(teleconvertersFor(validateScene({ tc: 2 }).tc)).toEqual([Teleconverter.X20]);
    expect(teleconvertersFor(validateScene({ tc: '1.4' }).tc)).toEqual([Teleconverter.X14]);
    expect(teleconvertersFor(validateScene({ f: '600' }).tc)).toEqual([]);
    // Absent for none, so the common case stays out of the URL.
    expect(viewfinderSearchFor(world(), { focalMm: 600, orientation: Orientation.Landscape, teleconverters: [] }).tc).toBeUndefined();
    for (const junk of ['3', 1.7, 0, 'x', null]) expect(teleconvertersFor(validateScene({ tc: junk }).tc)).toEqual([]);
    // Junk inside a stack is dropped, the rest still mounts.
    expect(teleconvertersFor(validateScene({ tc: '1.4,9' }).tc)).toEqual([Teleconverter.X14]);
  });

  it('drops junk fields silently', () => {
    expect(validateScene({ camera: '200,0', target: 'x', z: 'nope', t: '??', tz: '', f: '0', o: 'q' })).toEqual({
      camera: undefined,
      target: undefined,
      z: undefined,
      t: undefined,
      tz: undefined,
      f: undefined,
      o: undefined,
      tc: undefined
    });
  });
});
