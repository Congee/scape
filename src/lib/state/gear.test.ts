import { describe, expect, it } from 'vitest';
import { fitToLens, isCameraBody, type LensSpec } from '@core/optics/fov';
import { defaultKitName, kitMatches, type Kit } from './gear';

const zoom: LensSpec = { id: 'cat:Sony FE 100-400mm F4.5-5.6 GM OSS (E)', name: 'Sony FE 100-400mm', minMm: 100, maxMm: 400, maxAperture: 4.5, mount: 'E' };
const prime: LensSpec = { id: 'cat:Sony FE 50mm F1.2 GM (E)', name: 'Sony FE 50mm', minMm: 50, maxMm: 50, maxAperture: 1.2, mount: 'E' };

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
