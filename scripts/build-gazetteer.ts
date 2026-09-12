/**
 * Builds the bundled offline place index in public/gazetteer from the GeoNames dump:
 *   bun scripts/build-gazetteer.ts <path to cities5000.txt>
 * cities5000 (CC BY 4.0): every populated place above 5,000 people, sorted by population.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src) throw new Error('usage: bun scripts/build-gazetteer.ts <path to cities5000.txt>');
const out = join(import.meta.dir, '../public/gazetteer');

// GeoNames tab-separated columns.
const NAME = 1;
const LAT = 4;
const LNG = 5;
const COUNTRY = 8;
const POPULATION = 14;

const r4 = (v: string) => Math.round(Number(v) * 1e4) / 1e4;

type Row = [name: string, lat: number, lng: number, country: string, population: number];

const cities: Row[] = [];
for (const line of readFileSync(src, 'utf8').split('\n')) {
  if (!line) continue;
  const c = line.split('\t');
  cities.push([c[NAME], r4(c[LAT]), r4(c[LNG]), c[COUNTRY], Number(c[POPULATION]) || 0]);
}
cities.sort((a, b) => b[4] - a[4]);

const date = new Date().toISOString().slice(0, 10);
const source = `GeoNames cities5000, CC BY 4.0, downloaded ${date}`;
writeFileSync(join(out, 'cities.json'), JSON.stringify({ source, cities }));
console.log(`cities: ${cities.length}, largest: ${cities[0][0]} (${cities[0][4].toLocaleString()})`);
