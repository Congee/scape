import { describe, expect, it } from 'vitest';
import { foldName, rankCities, type City } from './gazetteer';

const city = (name: string, population: number): City => ({ name, lat: 0, lng: 0, country: 'XX', population });

const cities: City[] = [
  city('New York City', 8_000_000),
  city('Yorkshire', 500_000),
  city('York', 150_000),
  city('Zermatt', 5_800),
  city('Zürich', 380_000),
  city('São Paulo', 10_000_000)
];

describe('gazetteer', () => {
  it('folds case and diacritics', () => {
    expect(foldName('Zürich')).toBe('zurich');
    expect(foldName('São Paulo')).toBe('sao paulo');
  });

  it('ranks prefixes above word starts above substrings', () => {
    expect(rankCities('york', cities).map((c) => c.name)).toEqual(['Yorkshire', 'York', 'New York City']);
  });

  it('breaks ties by population', () => {
    expect(rankCities('z', cities).map((c) => c.name)).toEqual(['Zürich', 'Zermatt']);
  });

  it('matches folded queries against accented names', () => {
    expect(rankCities('zuri', cities).map((c) => c.name)).toEqual(['Zürich']);
    expect(rankCities('sao pa', cities).map((c) => c.name)).toEqual(['São Paulo']);
  });

  it('honours the limit', () => {
    expect(rankCities('o', cities, 2)).toHaveLength(2);
  });

  it('returns nothing for an empty query', () => {
    expect(rankCities('', cities)).toEqual([]);
    expect(rankCities('   ', cities)).toEqual([]);
  });
});
