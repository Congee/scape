/**
 * Builds the bundled sky data in public/sky from the raw catalogues:
 *   bun scripts/build-sky.ts <dir with hygdata_v41.csv, constellations.lines.json, constellations.json>
 * Stars: HYG v4.1 (CC BY-SA 4.0) to magnitude 6.5, sorted brightest first, as a compact binary.
 * Constellations: d3-celestial (BSD-3-Clause) lines and label positions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeStarCatalog, type StarRecord } from '../src/lib/core/astro/stars';

const MAG_LIMIT = 6.5;
const src = process.argv[2];
if (!src) throw new Error('usage: bun scripts/build-sky.ts <source dir>');
const out = join(import.meta.dir, '../public/sky');

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

const lines = readFileSync(join(src, 'hygdata_v41.csv'), 'utf8').split('\n');
const header = parseCsvLine(lines[0]);
const col = (name: string) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`missing column ${name}`);
  return i;
};
const cId = col('id');
const cRa = col('ra');
const cDec = col('dec');
const cMag = col('mag');
const cCi = col('ci');
const cProper = col('proper');
const cBf = col('bf');

const stars: (StarRecord & { name: string })[] = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const c = parseCsvLine(lines[i]);
  if (c[cId] === '0') continue; // the Sun
  const mag = Number(c[cMag]);
  if (!(mag <= MAG_LIMIT)) continue;
  const ci = c[cCi] === '' ? 0.6 : Number(c[cCi]);
  stars.push({ raDeg: Number(c[cRa]) * 15, decDeg: Number(c[cDec]), mag, ci, name: c[cProper] || (mag <= 2.5 ? c[cBf] : '') });
}
stars.sort((a, b) => a.mag - b.mag);
writeFileSync(join(out, 'stars.bin'), new Uint8Array(encodeStarCatalog(stars)));
const names: [number, string][] = [];
stars.forEach((s, i) => {
  if (s.name) names.push([i, s.name]);
});
writeFileSync(join(out, 'star-names.json'), JSON.stringify(names));
console.log(`stars: ${stars.length} (mag ≤ ${MAG_LIMIT}), named: ${names.length}`);

interface LinesFeature {
  id: string;
  geometry: { type: 'MultiLineString'; coordinates: [number, number][][] };
}
interface NameFeature {
  id: string;
  properties: { name: string; en: string };
  geometry: { type: 'Point'; coordinates: [number, number] };
}
const r2 = (v: number) => Math.round(v * 100) / 100;
const ra360 = (raDeg: number) => r2(((raDeg % 360) + 360) % 360);
const linesJson = JSON.parse(readFileSync(join(src, 'constellations.lines.json'), 'utf8')) as { features: LinesFeature[] };
const namesJson = JSON.parse(readFileSync(join(src, 'constellations.json'), 'utf8')) as { features: NameFeature[] };
const constellations: Record<string, { name: string; at: [number, number]; lines: [number, number][][] }> = {};
for (const f of namesJson.features) {
  constellations[f.id] = { name: f.properties.name, at: [ra360(f.geometry.coordinates[0]), r2(f.geometry.coordinates[1])], lines: [] };
}
let segments = 0;
for (const f of linesJson.features) {
  const c = constellations[f.id];
  if (!c) throw new Error(`no name for ${f.id}`);
  c.lines = f.geometry.coordinates.map((line) => line.map(([ra, dec]) => [ra360(ra), r2(dec)] as [number, number]));
  segments += f.geometry.coordinates.reduce((n, line) => n + line.length - 1, 0);
}
writeFileSync(join(out, 'constellations.json'), JSON.stringify(constellations));
console.log(`constellations: ${Object.keys(constellations).length}, segments: ${segments}`);
