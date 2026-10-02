import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bodyAim, startAimFollow } from './aimLock';
import { AimLock, compositionStore } from './composition';
import { worldStore } from './world';

const PIN = { lng: 138.73, lat: 35.36 };
const NIGHT = Date.parse('2026-06-15T15:00:00Z');

describe('startAimFollow', () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    worldStore.getState().setPin(PIN);
    worldStore.getState().setTime(NIGHT);
    compositionStore.setState({ aimLock: AimLock.Free, azimuthDeg: 0, elevationDeg: 0 });
    stop = startAimFollow();
  });
  afterEach(() => stop?.());

  it('re-aims a GC lock at the body as the time changes', () => {
    compositionStore.getState().update({ aimLock: AimLock.Gc });
    const first = compositionStore.getState().azimuthDeg;
    worldStore.getState().setTime(NIGHT + 2 * 3_600_000);
    const c = compositionStore.getState();
    expect(c.azimuthDeg).not.toBeCloseTo(first, 1);
    const want = bodyAim(AimLock.Gc, NIGHT + 2 * 3_600_000, worldStore.getState().pin, 0)!;
    expect(c.azimuthDeg).toBeCloseTo(want.azimuthDeg, 0);
    expect(c.elevationDeg).toBeCloseTo(want.elevationDeg, 0);
  });

  it('keeps a body below the horizon below it', () => {
    compositionStore.getState().update({ aimLock: AimLock.Sun });
    expect(compositionStore.getState().elevationDeg).toBeLessThan(0);
  });

  it('stops following once aimed by hand', () => {
    compositionStore.getState().update({ aimLock: AimLock.Moon });
    compositionStore.getState().aim(10, 5);
    worldStore.getState().setTime(NIGHT + 3_600_000);
    expect(compositionStore.getState()).toMatchObject({ aimLock: AimLock.Free, azimuthDeg: 10, elevationDeg: 5 });
  });

  it('leaves Target and Free to the stored angles', () => {
    expect(bodyAim(AimLock.Target, NIGHT, PIN, 0)).toBeNull();
    expect(bodyAim(AimLock.Free, NIGHT, PIN, 0)).toBeNull();
  });
});
