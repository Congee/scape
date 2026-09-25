/**
 * Builds public/eclipses/besselian.json, the polynomial Besselian elements of every solar eclipse 2000–2100,
 * from NASA GSFC's Five Millennium Canon element tables (Espenak and Meeus, public domain):
 *   bun scripts/build-eclipses.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://eclipse.gsfc.nasa.gov';
const CATALOGS = ['/SEcat5/SE1901-2000.html', '/SEcat5/SE2001-2100.html'];
const FIRST_YEAR = 2000;
const LAST_YEAR = 2100;
const out = join(import.meta.dir, '../public/eclipses');

async function text(url: string, attempt = 0): Promise<string> {
  const res = await fetch(url);
  if (res.ok) return res.text();
  if (attempt >= 4) throw new Error(`${res.status} ${url}`);
  await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  return text(url, attempt + 1);
}

const num = (s: string | undefined, what: string) => {
  const x = Number(s);
  if (s === undefined || !Number.isFinite(x)) throw new Error(`bad ${what}: ${s}`);
  return x;
};

// [JD of t0's TDT midnight, t0 h, ΔT s, x0..x3, y0..y3, d0..d2, μ0..μ2, l1 0..2, l2 0..2, tan f1, tan f2]
type Row = number[];

function parse(html: string, id: string): Row {
  const pre = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
  const jd = num(/JD = ([\d.]+)/.exec(pre)?.[1], `${id} JD`);
  const dt = num(/&Delta;T = +(-?[\d.]+) s/.exec(pre)?.[1], `${id} ΔT`);
  const t0 = num(/([\d.]+) TDT +\(=t0\)/.exec(pre)?.[1], `${id} t0`);
  const k1 = num(/k1 = ([\d.]+)/.exec(pre)?.[1], `${id} k1`);
  const k2 = num(/k2 = ([\d.]+)/.exec(pre)?.[1], `${id} k2`);
  if (k1 !== 0.272488 || k2 !== 0.272281) throw new Error(`${id}: unexpected lunar radii ${k1} ${k2}`);
  // Greatest eclipse lies within an hour of t0, so this is t0's own TDT midnight.
  const midnight = Math.round(jd - t0 / 24 - 0.5) + 0.5;
  const cols: number[][] = [];
  for (const n of [0, 1, 2, 3]) {
    const line = new RegExp(`^ +${n} +(-?[\\d.]+.*)$`, 'm').exec(pre.slice(pre.indexOf('n        x')))?.[1];
    if (!line) throw new Error(`${id}: no row ${n}`);
    cols.push(line.split(/\s+/).filter((s) => /^-?[\d.]+$/.test(s)).map((s) => num(s, `${id} row ${n}`)));
  }
  const tanF1 = num(/tan f1 = ([\d.]+)/.exec(pre)?.[1], `${id} tan f1`);
  const tanF2 = num(/tan f2 = ([\d.]+)/.exec(pre)?.[1], `${id} tan f2`);
  const col = (j: number, n: number) => cols.slice(0, n).map((r) => r[j]);
  // Columns: x y d l1 l2 μ; row 3 carries only x and y.
  return [midnight, t0, dt, ...col(0, 4), ...col(1, 4), ...col(2, 3), ...col(5, 3), ...col(3, 3), ...col(4, 3), tanF1, tanF2];
}

const ids: string[] = [];
for (const html of await Promise.all(CATALOGS.map((c) => text(SITE + c)))) {
  for (const m of html.matchAll(/SEdata\.php\?Ecl=\+?(\d{8})/g)) {
    const year = Number(m[1].slice(0, 4));
    if (year >= FIRST_YEAR && year <= LAST_YEAR && !ids.includes(m[1])) ids.push(m[1]);
  }
}
const rows: Row[] = [];
for (const id of ids) {
  // oxlint-disable-next-line no-await-in-loop -- one page at a time, gently
  rows.push(parse(await text(`${SITE}/SEsearch/SEdata.php?Ecl=${id}`), id));
  // oxlint-disable-next-line no-await-in-loop -- a pause between pages
  await new Promise((r) => setTimeout(r, 200));
}
mkdirSync(out, { recursive: true });
const body = rows.map((r) => JSON.stringify(r)).join(',\n');
writeFileSync(join(out, 'besselian.json'), `{"k1":0.272488,"k2":0.272281,"elements":[\n${body}\n]}\n`);
console.log(`${rows.length} eclipses`);
