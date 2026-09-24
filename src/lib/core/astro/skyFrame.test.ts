import { describe, expect, it } from 'vitest';
import { makeObserver, SkyBody } from './bodies';
import { position } from './positions';
import { apparentAltitude } from './refraction';
import { apply, enuToEqj, eqjToEnu, horizontalOf, poleEnu, refractEnu } from './skyFrame';
import { eqjVector, POLARIS } from './stars';

const D2R = Math.PI / 180;
const obs = makeObserver({ lat: 45, lng: 7 });
const time = new Date('2026-06-21T00:00:00Z');
const azDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('sky frame', () => {
  it('puts Polaris near the pole above true north', () => {
    const out = new Float64Array(3);
    const [x, y, z] = eqjVector(POLARIS.raDeg, POLARIS.decDeg);
    apply(eqjToEnu(time, obs), x, y, z, out);
    const h = horizontalOf(out[0], out[1], out[2]);
    expect(azDiff(h.azimuthDeg, 0)).toBeLessThan(1.2);
    expect(Math.abs(h.altitudeDeg - 45)).toBeLessThan(1);
  });

  it('agrees with astronomy-engine for the Galactic Centre', () => {
    const out = new Float64Array(3);
    const [x, y, z] = eqjVector(17.76112 * 15, -29.00781);
    for (const h of [0, 6, 12, 18]) {
      const t = new Date(time.getTime() + h * 3_600_000);
      apply(eqjToEnu(t, obs), x, y, z, out);
      const mine = horizontalOf(out[0], out[1], out[2]);
      const ref = position(SkyBody.Gc, t, obs);
      expect(azDiff(mine.azimuthDeg, ref.azimuth)).toBeLessThan(0.05);
      expect(Math.abs(mine.altitudeDeg - ref.altitude)).toBeLessThan(0.03);
    }
  });

  it('inverts', () => {
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    apply(eqjToEnu(time, obs), 0.3, -0.5, 0.8124, a);
    apply(enuToEqj(time, obs), a[0], a[1], a[2], b);
    expect(b[0]).toBeCloseTo(0.3, 9);
    expect(b[1]).toBeCloseTo(-0.5, 9);
    expect(b[2]).toBeCloseTo(0.8124, 9);
  });

  it('finds the celestial pole at the latitude', () => {
    const [e, n, u] = poleEnu(time, obs);
    const h = horizontalOf(e, n, u, false);
    expect(azDiff(h.azimuthDeg, 0)).toBeLessThan(0.01);
    expect(h.altitudeDeg).toBeCloseTo(45, 2);
  });

  it('lifts a direction by the refraction and keeps its azimuth', () => {
    const out = new Float64Array(3);
    for (const alt of [45, 10, 0.5, -1]) {
      const g = alt * D2R;
      refractEnu(Math.cos(g) * Math.sin(1), Math.cos(g) * Math.cos(1), Math.sin(g), out);
      const h = horizontalOf(out[0], out[1], out[2], false);
      expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1, 12);
      expect(h.azimuthDeg).toBeCloseTo(1 / D2R, 9);
      expect(h.altitudeDeg).toBeCloseTo(apparentAltitude(alt), 9);
    }
    refractEnu(0, Math.cos(45 * D2R), Math.sin(45 * D2R), out);
    expect((horizontalOf(out[0], out[1], out[2], false).altitudeDeg - 45) * 3600).toBeCloseTo(60.8, 0);
  });
});
