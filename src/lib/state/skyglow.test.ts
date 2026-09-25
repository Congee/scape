import { describe, expect, it } from 'vitest';
import type { ViirsStore } from '@data/viirs';
import { missingTiles, offerYear, yearFor } from './skyglow';

const ROTTERDAM = { lat: 51.92, lng: 4.48 };
const store = (tiles: [number, string][], listings: ViirsStore['listings'] = {}): ViirsStore => ({ tiles: tiles.map(([year, tile]) => ({ year, tile, bytes: 0 })), listings });

describe('skyglow tile choice', () => {
  it('uses the newest year holding the point’s own tile', () => {
    expect(yearFor(ROTTERDAM, store([[2023, 'h18v03'], [2024, 'h18v03'], [2025, 'h19v03']]))).toBe(2024);
    expect(yearFor(ROTTERDAM, store([[2024, 'h19v03']]))).toBeNull();
  });

  it('lists unimported tiles within the margin, trusting the listing when there is one', () => {
    const s = store([[2024, 'h18v03']]);
    expect(missingTiles(ROTTERDAM, 2024, s)).toEqual(['h17v03', 'h17v04', 'h18v04']);
    expect(missingTiles(ROTTERDAM, 2024, { ...s, listings: { 2024: ['h18v03', 'h18v04'] } })).toEqual(['h18v04']);
  });

  it('offers the newest listed year, else last year', () => {
    expect(offerYear(store([], { 2023: [], 2024: [] }))).toBe(2024);
    expect(offerYear(store([]), new Date('2026-09-24'))).toBe(2025);
  });
});
