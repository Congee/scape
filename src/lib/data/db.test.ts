import { describe, expect, it } from 'vitest';
import { DB_VERSION, isScapeExport, replaceQuestion, upgradeScape, type Upgradable } from './db';

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

describe('isScapeExport', () => {
  const base = { format: 'scape', version: 1, exportedAt: '', locations: [], markers: [], plans: [] };
  const record = { id: 'm', name: 'M', source: 'Imported', groundM: null, suppressOverture: true, visible: true, attribution: '', notes: '', createdAt: 0, updatedAt: 0, glb: '' };

  it('accepts older exports without searches or models', () => {
    expect(isScapeExport(base)).toBe(true);
    expect(isScapeExport({ ...base, searches: [] })).toBe(true);
  });

  it('accepts model records and rejects malformed ones', () => {
    expect(isScapeExport({ ...base, models: [record] })).toBe(true);
    expect(isScapeExport({ ...base, models: {} })).toBe(false);
    expect(isScapeExport({ ...base, models: [{ ...record, glb: 1 }] })).toBe(false);
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
