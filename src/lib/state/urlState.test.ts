import { describe, expect, it } from 'vitest';
import { DEFAULT_SENSOR_ID, Orientation, Teleconverter, type SensorFormat } from '@core/optics/fov';
import { DEFAULT_COMPOSITION } from './composition';
import { DEFAULT_FOCAL_MM, DEFAULT_ZOOM, aimIsFree, formatInstant, formatPoint, parseInstant, parseNumber, parsePoint, retargeted, searchFor, stateFor, validateScene, type Scene, type SceneSearch } from './urlState';

const HOBOKEN = { lat: 40.747952, lng: -74.023685 };
const EDGE = { lat: 40.753918, lng: -74.000996 };
const TIME = Date.parse('2026-10-26T23:01:25Z');
const MINUTE = Date.parse('2026-10-26T23:01:00Z');
const at6 = (p: { lat: number; lng: number }) => ({ ...p, digits: { lat: 6, lng: 6 } });

const BASE: Scene = {
  pin: HOBOKEN,
  pinHeightM: 0,
  pin2: null,
  pin2HeightM: 0,
  pin2HeightAuto: false,
  view: { center: HOBOKEN, zoom: DEFAULT_ZOOM, bearing: 0, pitch: 0 },
  aimLock: 'Target',
  azimuthDeg: 0,
  elevationDeg: 0,
  focalMm: DEFAULT_FOCAL_MM,
  orientation: Orientation.Landscape,
  teleconverters: [],
  sensorId: DEFAULT_SENSOR_ID,
  time: null,
  tz: null
};
const scene = (over: Partial<Scene> = {}): Scene => ({ ...BASE, ...over });
/** Through the router: every value becomes text or a number, then validated. */
const viaUrl = (q: SceneSearch) => validateScene(JSON.parse(JSON.stringify(q)) as Record<string, unknown>);

describe('urlState', () => {
  it('writes points at their known digits and reads the digits back', () => {
    expect(formatPoint({ lat: 44.47, lng: -72.7, digits: { lat: 2, lng: 1 } })).toBe('44.47,-72.7');
    expect(parsePoint('44.47,-72.7')).toEqual({ lat: 44.47, lng: -72.7, digits: { lat: 2, lng: 1 } });
    expect(parsePoint('44.4700,-72.700')).toEqual({ lat: 44.47, lng: -72.7, digits: { lat: 4, lng: 3 } });
    const p = { lat: 44.4700001, lng: -72.7, digits: { lat: 4, lng: 3 } };
    expect(parsePoint(formatPoint(p))).toEqual({ lat: 44.47, lng: -72.7, digits: { lat: 4, lng: 3 } });
  });

  it('writes points of unknown precision at six decimals without trailing zeros', () => {
    expect(formatPoint(HOBOKEN)).toBe('40.747952,-74.023685');
    expect(formatPoint({ lat: 40.5, lng: -74 })).toBe('40.5,-74');
    expect(formatPoint({ lat: 40.12345678, lng: -74.1 })).toBe('40.123457,-74.1');
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

  it('keeps its defaults in step with the stores', () => {
    expect(DEFAULT_FOCAL_MM).toBe(DEFAULT_COMPOSITION.focalMm);
    expect(DEFAULT_COMPOSITION.sensorId).toBe(DEFAULT_SENSOR_ID);
  });

  it('round-trips every key', () => {
    const custom: SensorFormat[] = [{ id: 'custom:1', name: 'Mine', widthMm: 30, heightMm: 20 }];
    const s = scene({
      pinHeightM: 12.34,
      pin2: EDGE,
      pin2HeightM: 120.04,
      pin2HeightAuto: true,
      view: { center: { lat: 40.71, lng: -74.01 }, zoom: 14.567, bearing: -33.33, pitch: 45.06 },
      aimLock: 'Free',
      azimuthDeg: 123.44,
      elevationDeg: -2.36,
      focalMm: 135.25,
      orientation: Orientation.Portrait,
      teleconverters: [Teleconverter.X14, Teleconverter.X20],
      sensorId: 'custom:1',
      time: TIME,
      tz: 'America/New_York'
    });
    const q = searchFor(s, custom);
    expect(q).toEqual({
      c: '40.747952,-74.023685',
      ch: 12.3,
      tg: '40.753918,-74.000996',
      th: '120a',
      m: '40.71,-74.01',
      z: 14.57,
      b: -33.3,
      pt: 45.1,
      a: 'f',
      az: 123.4,
      el: -2.4,
      f: 135.3,
      o: 'p',
      tc: '1.4,2',
      s: 'custom:1:30x20',
      t: '2026-10-26T23:01Z',
      tz: 'America/New_York'
    });
    const back = stateFor(viaUrl(q), BASE, custom);
    expect(back).toEqual({
      ...s,
      pin: at6(HOBOKEN),
      pinHeightM: 12.3,
      pin2: at6(EDGE),
      pin2HeightM: 120,
      view: { center: { lat: 40.71, lng: -74.01, digits: { lat: 2, lng: 2 } }, zoom: 14.57, bearing: -33.3, pitch: 45.1 },
      azimuthDeg: 123.4,
      elevationDeg: -2.4,
      focalMm: 135.3,
      time: MINUTE
    });
    expect(searchFor(back, custom)).toEqual(q);
  });

  it('round-trips each lock and keeps a locked aim out of the URL', () => {
    for (const [aimLock, a] of [['Sun', 's'], ['Moon', 'm'], ['Gc', 'g']] as const) {
      const q = searchFor(scene({ pin2: EDGE, aimLock, azimuthDeg: 200 }));
      expect(q).toMatchObject({ a, az: undefined, el: undefined });
      expect(stateFor(viaUrl(q), BASE).aimLock).toBe(aimLock);
    }
    const target = searchFor(scene({ pin2: EDGE, azimuthDeg: 200 }));
    expect(target.a).toBeUndefined();
    expect(target.az).toBeUndefined();
    // A target lock without a target aims where it was left.
    expect(aimIsFree(scene())).toBe(true);
    expect(searchFor(scene({ azimuthDeg: 200, elevationDeg: 5 }))).toMatchObject({ a: undefined, az: 200, el: 5 });
  });

  it('omits defaults', () => {
    expect(searchFor(scene())).toEqual({ c: '40.747952,-74.023685', az: 0, el: 0 });
    expect(JSON.parse(JSON.stringify(searchFor(scene({ pin2: EDGE }))))).toEqual({ c: '40.747952,-74.023685', tg: '40.753918,-74.000996' });
    // A typed zero height and a lone converter.
    expect(searchFor(scene({ pin2: EDGE, pin2HeightM: 30, teleconverters: [Teleconverter.X20] }))).toMatchObject({ th: 30, tc: 2 });
    expect(searchFor(scene({ sensorId: 'apsc' })).s).toBe('apsc');
  });

  it('rounds the aim to 0.1° and the centre to the pixel at its zoom', () => {
    expect(searchFor(scene({ aimLock: 'Free', azimuthDeg: 359.96 })).az).toBe(0);
    expect(searchFor(scene({ aimLock: 'Free', azimuthDeg: -10.04 })).az).toBe(350);
    const centre = { lat: 40.123456789, lng: -74.987654321 };
    expect(searchFor(scene({ view: { center: centre, zoom: 5, bearing: 0, pitch: 0 } })).m).toBe('40.12,-74.99');
    expect(searchFor(scene({ view: { center: centre, zoom: 18, bearing: 0, pitch: 0 } })).m).toBe('40.123457,-74.987654');
    // Within a pixel of the camera reads as centred on it.
    expect(searchFor(scene({ view: { center: { lat: HOBOKEN.lat + 0.001, lng: HOBOKEN.lng }, zoom: 5, bearing: 0, pitch: 0 } })).m).toBeUndefined();
  });

  it('resolves a custom sensor the reader lacks by size', () => {
    expect(stateFor({ c: '1,1', s: 'custom:9:23.4x15.5' }, BASE).sensorId).toBe('apsc');
    expect(stateFor({ c: '1,1', s: 'custom:9:99x99' }, BASE).sensorId).toBe(DEFAULT_SENSOR_ID);
    expect(stateFor({ c: '1,1', s: 'mft' }, BASE).sensorId).toBe('mft');
  });

  it('takes defaults for a whole scene but keeps the current state for a partial one', () => {
    const cur = scene({ pin2: EDGE, focalMm: 400, aimLock: 'Sun', time: TIME, tz: 'Europe/Paris', sensorId: 'apsc', view: { center: EDGE, zoom: 15, bearing: 10, pitch: 20 } });
    const whole = stateFor({ c: '40.5,-74' }, cur);
    expect(whole).toMatchObject({ pin2: null, focalMm: DEFAULT_FOCAL_MM, aimLock: 'Target', time: null, tz: null, sensorId: DEFAULT_SENSOR_ID });
    expect(whole.view).toEqual({ center: whole.pin, zoom: DEFAULT_ZOOM, bearing: 0, pitch: 0 });
    expect(stateFor({}, cur)).toEqual(cur);
    expect(stateFor({ f: 200 }, cur)).toEqual({ ...cur, focalMm: 200 });
  });

  it('loads links made before the short keys', () => {
    const cur = scene({ focalMm: 400, orientation: Orientation.Portrait, teleconverters: [Teleconverter.X14], time: TIME });
    const q = validateScene({ camera: '40.747952,-74.023685', target: '40.753918,-74.000996', z: 14, t: '2026-10-26T23:01Z', tz: 'America/New_York' });
    const s = stateFor(q, cur);
    expect(s).toMatchObject({ pin: at6(HOBOKEN), pin2: at6(EDGE), time: MINUTE, tz: 'America/New_York', focalMm: 400 });
    // The camera centred the map.
    expect(s.view).toMatchObject({ center: at6(HOBOKEN), zoom: 14 });
    // Viewfinder links always carried `f`, so a missing `o` or `tc` meant the default.
    expect(stateFor(validateScene({ camera: '1,1', f: '600', tc: 2 }), cur)).toMatchObject({ focalMm: 600, orientation: Orientation.Landscape, teleconverters: [Teleconverter.X20] });
    expect(stateFor(validateScene({ tc: '1.4' }), cur).teleconverters).toEqual([Teleconverter.X14]);
  });

  it('drops junk fields silently', () => {
    const junk = validateScene({ c: '200,0', tg: 'x', camera: '1;2', th: 'ha', ch: 'x', m: '', z: 'nope', b: 999, pt: 91, a: 'q', az: 'n', el: 100, f: '0', o: 'q', tc: '3', s: '../x', t: '??', tz: '' });
    expect(JSON.parse(JSON.stringify(junk))).toEqual({});
    expect(stateFor(junk, BASE)).toEqual(BASE);
    // Junk inside a stack is dropped, the rest still mounts.
    expect(validateScene({ tc: '1.4,9' }).tc).toBe(1.4);
  });

  it('faces the target again on entering the viewfinder unless a sky body holds the aim', () => {
    expect(retargeted({ c: '1,1', tg: '2,2', a: 'f', az: 3, el: 4 })).toEqual({ c: '1,1', tg: '2,2', a: undefined, az: undefined, el: undefined });
    expect(retargeted({ c: '1,1', tg: '2,2', a: 's' }).a).toBe('s');
    expect(retargeted({ c: '1,1', a: 'f', az: 3 }).az).toBe(3);
  });
});
