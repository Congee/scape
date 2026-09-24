import { describe, expect, it } from 'vitest';
import { rawBytesPerShot, sequenceTime, timelapse, TimelapseSolve } from './timelapse';

describe('time-lapse calculator', () => {
  it('PhotoPills timelapse guide, fast clouds: 1 s interval over 20 min is 1200 photos, 48 s at 25 fps', () => {
    const t = timelapse({ intervalS: 1, eventS: 20 * 60, clipS: 0, fps: 25 }, TimelapseSolve.Clip);
    expect(t.shots).toBe(1200);
    expect(t.clipS).toBeCloseTo(48, 9);
    expect(t.speedup).toBe(25);
  });

  it('textbook arithmetic: a 30 s clip at 24 fps from a 2 h sunset needs a 10 s interval', () => {
    const t = timelapse({ intervalS: 0, eventS: 2 * 3600, clipS: 30, fps: 24 }, TimelapseSolve.Interval);
    expect(t.intervalS).toBeCloseTo(10, 9);
    expect(t.shots).toBe(720);
  });

  it('solving for the event duration', () => {
    const t = timelapse({ intervalS: 5, eventS: 0, clipS: 10, fps: 30 }, TimelapseSolve.Event);
    expect(t.eventS).toBe(1500);
    expect(t.shots).toBe(300);
  });

  it('card space: a 45.7 MP 14-bit uncompressed raw is about 80 MB', () => {
    expect(rawBytesPerShot(45.7e6) / 1e6).toBeCloseTo(80, 0);
  });

  it('sequence time steps by the interval and wraps', () => {
    expect(sequenceTime(1000, 2, 10, 0)).toBe(1000);
    expect(sequenceTime(1000, 2, 10, 3)).toBe(7000);
    expect(sequenceTime(1000, 2, 10, 10)).toBe(1000);
    expect(sequenceTime(1000, 2, 10, -1)).toBe(19000);
  });
});
