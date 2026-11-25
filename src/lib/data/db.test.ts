import { describe, expect, it } from 'vitest';
import { DEFAULT_FINDER_SETTINGS } from '@core/astro/finder';
import { DB_VERSION, parseScapeExport, replaceQuestion, upgradeScape, type Upgradable } from './db';

function recorder() {
  const made: string[] = [];
  const d: Upgradable = {
    createObjectStore(name, options) {
      expect(options.keyPath).toBe('id');
      return {
        createIndex(index, keyPath) {
          made.push(`${name}.${index}:${keyPath}`);
        }
      };
    }
  };
  return { d, made };
}

describe('upgradeScape', () => {
  it('builds every store on a fresh database', () => {
    const { d, made } = recorder();
    upgradeScape(d, 0);
    expect(made).toEqual(['locations.byName:name', 'markers.byName:name', 'plans.byName:name', 'searches.byName:name', 'models.byName:name']);
  });

  it('adds only the models store from v3', () => {
    const { d, made } = recorder();
    upgradeScape(d, 3);
    expect(made).toEqual(['models.byName:name']);
    expect(DB_VERSION).toBe(4);
  });

  it('does nothing at the current version', () => {
    const { d, made } = recorder();
    upgradeScape(d, DB_VERSION);
    expect(made).toEqual([]);
  });
});

describe('parseScapeExport', () => {
  const base = { format: 'scape', version: 1, exportedAt: '', locations: [], markers: [], plans: [] };
  const record = { id: 'm', name: 'M', source: 'Imported', groundM: null, suppressOverture: true, visible: true, attribution: '', notes: '', createdAt: 0, updatedAt: 0, glb: '' };
  const composition = { sensorId: 'ff', focalMm: 50, fNumber: 8, orientation: 'Landscape', azimuthDeg: 10, elevationDeg: 2 };
  const plan = { id: 'p', name: 'P', camera: { lat: 1, lng: 2, heightM: 0 }, target: null, time: 5, tz: 'Asia/Tokyo', tzAuto: false, composition, notes: '', createdAt: 1, updatedAt: 2 };

  it('accepts older exports without searches or models', () => {
    expect(parseScapeExport(base)).toEqual(base);
    expect(parseScapeExport({ ...base, searches: [] }).searches).toEqual([]);
  });

  it('accepts model records and rejects malformed ones', () => {
    expect(parseScapeExport({ ...base, models: [record] }).models).toEqual([record]);
    expect(() => parseScapeExport({ ...base, models: {} })).toThrow();
    expect(() => parseScapeExport({ ...base, models: [{ ...record, glb: 1 }] })).toThrow('Model 1');
  });

  it('refuses garbage and records without an id or position', () => {
    for (const bad of [null, 'scape', [], { ...base, format: 'other' }, { ...base, plans: {} }]) expect(() => parseScapeExport(bad)).toThrow('Not a Scape export file');
    expect(() => parseScapeExport({ ...base, markers: [{ id: 'a', lat: 1 }] })).toThrow('Marker 1');
    expect(() => parseScapeExport({ ...base, locations: [{ lat: 1, lng: 2 }] })).toThrow('Location 1');
    expect(() => parseScapeExport({ ...base, plans: [plan, { ...plan, composition: { ...composition, orientation: 'Square' } }] })).toThrow('Plan 2');
    expect(() => parseScapeExport({ ...base, searches: [{ name: 'x' }] })).toThrow('Search 1');
  });

  it('keeps a good plan whole, legacy fields included', () => {
    const old = { ...plan, composition: { ...composition, teleconverter: 2, aimAtTarget: true } };
    expect(parseScapeExport({ ...base, plans: [plan, old] }).plans).toEqual([plan, old]);
  });

  it('gives soft fields their defaults', () => {
    const m = parseScapeExport({ ...base, markers: [{ id: 'a', lat: 1, lng: 2, category: 'Castle', rating: 'x', shape: 'Blob', stale: 1 }] }, 9).markers[0];
    expect(m).toEqual({ id: 'a', name: '', category: 'Other', lat: 1, lng: 2, heightM: 0, widthM: 0, rating: 0, notes: '', showInViewfinder: true, createdAt: 9, updatedAt: 9 });
    expect(parseScapeExport({ ...base, plans: [{ ...plan, tz: 'Mars/Olympus' }] }).plans[0].tz).toBe('Etc/UTC');
    const s = parseScapeExport({ ...base, searches: [{ id: 's', settings: { body: 'Pluto', days: 30 }, pin: 'here' }] }, 9).searches![0];
    expect(s.pin).toBeNull();
    expect(s.settings).toEqual({ ...DEFAULT_FINDER_SETTINGS, days: 30 });
  });
});

describe('replaceQuestion', () => {
  const none = { locations: 0, plans: 0, markers: 0, searches: 0, models: 0 };
  it('names what a replace wipes', () => {
    expect(replaceQuestion({ ...none, locations: 12, plans: 3, markers: 40 })).toBe('Replace 12 locations, 3 plans and 40 markers with this file?');
    expect(replaceQuestion({ ...none, plans: 1 })).toBe('Replace 1 plan with this file?');
    expect(replaceQuestion({ ...none, searches: 2, models: 1 })).toBe('Replace 2 searches and 1 3D model with this file?');
  });
  it('does not ask when nothing is saved', () => {
    expect(replaceQuestion(none)).toBeNull();
  });
});
