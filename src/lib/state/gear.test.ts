import { describe, expect, it } from 'vitest';
import { effectiveOptics, fitToLens, isCameraBody, Teleconverter, type LensSpec } from '@core/optics/fov';
import { DEFAULT_FOCALS, defaultKitName, GEAR_PERSIST, GEAR_VERSION, kitMatches, migrateGear, type Kit } from './gear';

const zoom: LensSpec = { id: 'cat:Sony FE 100-400mm F4.5-5.6 GM OSS (E)', name: 'Sony FE 100-400mm', minMm: 100, maxMm: 400, maxAperture: 4.5, mount: 'E' };
const prime: LensSpec = { id: 'cat:Sony FE 50mm F1.2 GM (E)', name: 'Sony FE 50mm', minMm: 50, maxMm: 50, maxAperture: 1.2, mount: 'E' };
const tele: LensSpec = { id: 'cat:Sony FE 600mm F4 GM OSS (E)', name: 'Sony FE 600mm', minMm: 600, maxMm: 600, maxAperture: 4, mount: 'E' };

describe('isCameraBody', () => {
  it('accepts catalogue and custom bodies', () => {
    expect(isCameraBody('cat:Sony α7R V')).toBe(true);
    expect(isCameraBody('custom:0f0e-1234')).toBe(true);
  });

  it('rejects the generic sensor formats', () => {
    expect(isCameraBody('ff')).toBe(false);
    expect(isCameraBody('apsc-canon')).toBe(false);
    expect(isCameraBody('mf44')).toBe(false);
  });
});

describe('fitToLens', () => {
  it('leaves the composition alone without a lens', () => {
    expect(fitToLens(null, 12, 1.4)).toEqual({ focalMm: 12, fNumber: 1.4 });
  });

  it('clamps the focal length to the zoom range', () => {
    expect(fitToLens(zoom, 35, 8).focalMm).toBe(100);
    expect(fitToLens(zoom, 800, 8).focalMm).toBe(400);
    expect(fitToLens(zoom, 200, 8).focalMm).toBe(200);
  });

  it('pins a prime to its focal length', () => {
    expect(fitToLens(prime, 35, 8).focalMm).toBe(50);
    expect(fitToLens(prime, 400, 8).focalMm).toBe(50);
  });

  it('opens no wider than the lens does', () => {
    expect(fitToLens(zoom, 200, 2.8).fNumber).toBe(4.5);
    expect(fitToLens(zoom, 200, 11).fNumber).toBe(11);
  });

  it('limits the aperture by maxAperture alone at every focal length', () => {
    for (const f of [100, 250, 400]) expect(fitToLens(zoom, f, 1.4).fNumber).toBe(4.5);
    for (const f of [100, 250, 400]) expect(fitToLens(zoom, f, 4.5).fNumber).toBe(4.5);
  });

  it('clamps the base focal, leaving the teleconverter free to go past the lens', () => {
    const base = fitToLens(tele, 1200, 4);
    expect(base).toEqual({ focalMm: 600, fNumber: 4 });
    expect(effectiveOptics({ ...base, teleconverters: [Teleconverter.X20] })).toEqual({ focalMm: 1200, fNumber: 8 });
  });

  it('rounds the focal length to a tenth', () => {
    expect(fitToLens({ ...zoom, minMm: 100.44 }, 50, 8).focalMm).toBe(100.4);
  });
});

describe('kitMatches', () => {
  const kit: Kit = { id: 'k1', name: 'α7R V + 100-400', cameraId: 'cat:Sony α7R V', lensId: zoom.id };

  it('needs both the camera and the lens', () => {
    expect(kitMatches(kit, { sensorId: kit.cameraId, lensId: zoom.id })).toBe(true);
    expect(kitMatches(kit, { sensorId: kit.cameraId, lensId: prime.id })).toBe(false);
    expect(kitMatches(kit, { sensorId: 'ff', lensId: zoom.id })).toBe(false);
  });

  it('matches a body-only kit only when no lens is set', () => {
    const bare: Kit = { ...kit, lensId: null };
    expect(kitMatches(bare, { sensorId: kit.cameraId, lensId: null })).toBe(true);
    expect(kitMatches(bare, { sensorId: kit.cameraId, lensId: zoom.id })).toBe(false);
  });
});

describe('defaultKitName', () => {
  it('drops the lens make when the camera already says it', () => {
    expect(defaultKitName('Sony α7R V', 'Sony FE 100-400mm F4.5-5.6 GM OSS')).toBe('Sony α7R V + FE 100-400mm F4.5-5.6 GM OSS');
  });

  it('keeps a third-party make', () => {
    expect(defaultKitName('Sony α7R V', 'Sigma 24-70mm F2.8 DG DN II | Art')).toBe('Sony α7R V + Sigma 24-70mm F2.8 DG DN II | Art');
  });

  it('names the body alone without a lens', () => {
    expect(defaultKitName('Nikon Z 8', null)).toBe('Nikon Z 8');
  });

  it('does not chop a make that is only a prefix', () => {
    expect(defaultKitName('Sony α7R V', 'Sonyx 50mm')).toBe('Sony α7R V + Sonyx 50mm');
  });
});

describe('migrateGear', () => {
  const old = [14, 16, 20, 24, 28, 35, 50, 70, 85, 100, 135, 200, 300, 400, 600];

  it('adds newly shipped presets to a v0 profile', () => {
    expect(migrateGear({ cameras: [], lenses: [], kits: [], focalPresets: old }, 0).focalPresets).toEqual(DEFAULT_FOCALS);
  });

  it('keeps the user’s own presets, sorted and de-duplicated', () => {
    const stored = [...old, 12, 400];
    expect(migrateGear({ focalPresets: stored }, 0).focalPresets).toEqual([12, ...DEFAULT_FOCALS]);
  });

  it('carries the rest of the profile through', () => {
    const kit: Kit = { id: 'k1', name: 'α7R V', cameraId: 'cat:Sony α7R V', lensId: null };
    const s = migrateGear({ cameras: [], lenses: [prime], kits: [kit], focalPresets: old }, 0);
    expect(s.lenses).toEqual([prime]);
    expect(s.kits).toEqual([kit]);
  });

  it('leaves a current profile’s presets alone', () => {
    expect(migrateGear({ focalPresets: [50, 100] }, 1).focalPresets).toEqual([50, 100]);
  });

  it('strips the long-end aperture a v2 profile stored, keeping the rest', () => {
    const saved: LensSpec = { id: 'cat:Sony FE 200-600mm F5.6-6.3 G OSS (E)', name: 'Sony FE 200-600mm F5.6-6.3 G OSS', minMm: 200, maxMm: 600, maxAperture: 5.6, mount: 'E' };
    const kit: Kit = { id: 'k1', name: 'α7R V', cameraId: 'cat:Sony α7R V', lensId: saved.id };
    const g = migrateGear({ cameras: [], lenses: [{ ...saved, maxApertureLong: 6.3 }, prime], kits: [kit], focalPresets: [50, 100] }, 2);
    expect(g).toEqual({ cameras: [], lenses: [saved, prime], kits: [kit], focalPresets: [50, 100] });
    expect(g.lenses[0]).not.toHaveProperty('maxApertureLong');
  });

  it('does not re-union the presets of a v1 profile', () => {
    expect(migrateGear({ focalPresets: [50, 100], lenses: [] }, 1).focalPresets).toEqual([50, 100]);
  });

  it('takes a v1 profile to the current version without adding a long-end aperture', () => {
    const saved: LensSpec = { id: 'l', name: 'Canon RF 100-400mm F5.6-8 IS USM', minMm: 100, maxMm: 400, maxAperture: 5.6, mount: 'RF' };
    expect(migrateGear({ focalPresets: [12], lenses: [saved] }, 1)).toEqual({ cameras: [], lenses: [saved], kits: [], focalPresets: [12] });
  });

  it('runs the preset step on a v0 profile', () => {
    const saved: LensSpec = { id: 'l', name: 'Canon RF 100-400mm F5.6-8 IS USM', minMm: 100, maxMm: 400, maxAperture: 5.6, mount: 'RF' };
    const g = migrateGear({ focalPresets: [12], lenses: [saved] }, 0);
    expect(g.lenses).toEqual([saved]);
    expect(g.focalPresets).toEqual([12, ...DEFAULT_FOCALS]);
  });

  it('leaves a current profile untouched', () => {
    expect(migrateGear({ lenses: [zoom, prime] }, GEAR_VERSION).lenses).toEqual([zoom, prime]);
  });

  it('survives a malformed lens list', () => {
    expect(migrateGear({ lenses: 'nope' }, 0).lenses).toEqual([]);
    expect(migrateGear({ lenses: [null, {}, { name: 7 }, { name: 'FE 200-600mm F5.6-6.3' }] }, 0).lenses).toEqual([null, {}, { name: 7 }, { name: 'FE 200-600mm F5.6-6.3' }]);
  });

  it('survives a missing or malformed persisted state', () => {
    expect(migrateGear(undefined, 0).focalPresets).toEqual(DEFAULT_FOCALS);
    expect(migrateGear({ focalPresets: null }, 0)).toEqual({ cameras: [], lenses: [], kits: [], focalPresets: DEFAULT_FOCALS });
  });
});

describe('gear persistence', () => {
  // The migration is useless unless the store actually runs it.
  it('runs the migration on a stored profile older than the current version', () => {
    expect(GEAR_PERSIST.name).toBe('scape.gear');
    expect(GEAR_PERSIST.version).toBe(GEAR_VERSION);
    expect(GEAR_PERSIST.migrate({ focalPresets: [45] }, 0).focalPresets).toEqual([45, ...DEFAULT_FOCALS].toSorted((a, b) => a - b));
  });
});
