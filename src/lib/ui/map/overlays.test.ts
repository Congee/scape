import { describe, expect, it } from 'vitest';
import { SkyBody } from '@core/astro/bodies';
import type { HorizontalPos } from '@core/astro/positions';
import { ECLIPSED_MOON_COLOR, eclipsedMoonColor, LIVE_COLORS, liveLines } from './overlays';

const up = (azimuth: number) => ({ azimuth, altitude: 30 }) as HorizontalPos;
const down = { azimuth: 0, altitude: -30 } as HorizontalPos;
const pos = { Sun: down, Moon: up(160), Gc: down };
const opts = { showShadow: false, showGc: false, shadowHeightM: 2 };

describe('eclipsedMoonColor', () => {
  it('stays the live Moon blue outside the umbra and turns copper when fully inside', () => {
    expect(eclipsedMoonColor(0)).toBe(LIVE_COLORS.Moon);
    expect(eclipsedMoonColor(1)).toBe(ECLIPSED_MOON_COLOR);
    expect(eclipsedMoonColor(0.5)).toBe('#8d8197');
  });
});

describe('liveLines', () => {
  const moonColor = (moonUmbra?: number) => liveLines({ lng: 77.2, lat: 28.6 }, pos, 1000, { ...opts, moonUmbra }).features.find((f) => f.properties?.body === SkyBody.Moon)?.properties?.color;

  it('tints the Moon line by umbra coverage', () => {
    expect(moonColor()).toBe(LIVE_COLORS.Moon);
    expect(moonColor(1)).toBe(ECLIPSED_MOON_COLOR);
  });
});
