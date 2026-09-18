import { describe, expect, it } from 'vitest';
import { BODIES, bodyVisible, SkyBody } from './bodies';
import { DEFAULT_COMPOSITION } from '@state/composition';

describe('bodyVisible', () => {
  const on = { showSun: true, showMoon: true };

  it('follows each body its own flag', () => {
    expect(bodyVisible(SkyBody.Sun, { showSun: false, showMoon: true }, { showGc: true })).toBe(false);
    expect(bodyVisible(SkyBody.Moon, { showSun: true, showMoon: false }, { showGc: true })).toBe(false);
    expect(bodyVisible(SkyBody.Gc, on, { showGc: false })).toBe(false);
  });

  it('leaves the other bodies alone', () => {
    const c = { showSun: false, showMoon: false };
    expect(bodyVisible(SkyBody.Gc, c, { showGc: true })).toBe(true);
    expect(bodyVisible(SkyBody.Sun, on, { showGc: false })).toBe(true);
    expect(bodyVisible(SkyBody.Moon, on, { showGc: false })).toBe(true);
  });

  it('shows every body when all flags are on', () => {
    expect(BODIES.every((b) => bodyVisible(b, on, { showGc: true }))).toBe(true);
  });
});

describe('composition defaults', () => {
  it('shows the sun and the moon', () => {
    expect(DEFAULT_COMPOSITION.showSun).toBe(true);
    expect(DEFAULT_COMPOSITION.showMoon).toBe(true);
  });
});
