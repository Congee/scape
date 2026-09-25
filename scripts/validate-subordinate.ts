/**
 * Checks bundled subordinate predictions against NOAA CO-OPS's own published highs and lows for a sample of stations:
 *   bun scripts/validate-subordinate.ts <cache-dir> [yyyymm]
 * Fetches each missing month once with curl, a pause between requests; prints time and height errors.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStation, type TideStationRow } from '../src/lib/core/tides/predict';
import { parseSubordinate, subordinateExtremes, type SubordinateRow } from '../src/lib/core/tides/subordinate';

const [cache, month = '202611'] = process.argv.slice(2);
if (!cache) throw new Error('usage: bun scripts/validate-subordinate.ts <cache-dir> [yyyymm]');
const pub = join(import.meta.dir, '../public/tides');
const harmonic = new Map((JSON.parse(readFileSync(join(pub, 'stations.json'), 'utf8')) as { stations: TideStationRow[] }).stations.map((r) => [r[0], r]));
const subs = (JSON.parse(readFileSync(join(pub, 'subordinate.json'), 'utf8')) as { stations: SubordinateRow[] }).stations.toSorted((a, b) => a[0].localeCompare(b[0]));

// Spread across coasts: the middle station of each state (or of the unlabelled rest), plus the middle feet-added one where a state has them.
const groups = new Map<string, SubordinateRow[]>();
for (const r of subs) {
  const st = /, ([A-Z]{2})$/.exec(r[1])?.[1] ?? '--';
  groups.set(st, [...(groups.get(st) ?? []), r]);
}
const mid = <T>(xs: T[]) => xs[Math.floor(xs.length / 2)];
const sample: SubordinateRow[] = [];
for (const [st, rows] of groups) {
  sample.push(mid(rows.filter((r) => r[9] === 'R')) ?? mid(rows));
  const feet = rows.filter((r) => r[9] === 'F');
  if (feet.length) sample.push(mid(feet));
  // The biggest groups get a third pick at a quarter of the way through.
  if (rows.length > 150 && st !== '--') sample.push(rows[Math.floor(rows.length / 4)]);
}

const y = Number(month.slice(0, 4));
const m = Number(month.slice(4)) - 1;
const T0 = Date.UTC(y, m, 1);
const T1 = Date.UTC(y, m + 1, 1);
const last = new Date(T1 - 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');

interface Pred {
  t: string;
  v: string;
  type: 'H' | 'L';
}
function published(id: string): Pred[] {
  const file = join(cache, `${id}-${month}.json`);
  if (!existsSync(file)) {
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=scape_validation&begin_date=${month}01&end_date=${last}&datum=MLLW&station=${id}&time_zone=gmt&units=metric&interval=hilo&format=json`;
    const r = spawnSync('curl', ['-sSf', '--retry', '3', '--retry-delay', '10', '-o', file, url]);
    if (r.status !== 0) throw new Error(`curl ${id}: ${r.stderr.toString()}`);
    spawnSync('sleep', ['2']);
  }
  const body = JSON.parse(readFileSync(file, 'utf8')) as { predictions?: Pred[]; error?: { message: string } };
  if (!body.predictions) throw new Error(`${id}: ${body.error?.message ?? 'no predictions'}`);
  return body.predictions;
}

const dt: number[] = [];
const dh: number[] = [];
let unmatched = 0;
let total = 0;
console.log('| Station | Offsets | NOAA | Matched | Max Δt min | Max Δh cm |');
console.log('|---|---|---|---|---|---|');
for (const row of sample) {
  const sub = parseSubordinate(row);
  const ref = harmonic.get(sub.refId);
  if (!ref) throw new Error(`${sub.id}: no reference ${sub.refId}`);
  const got = subordinateExtremes(sub, parseStation(ref), T0, T1);
  const want = published(sub.id).map((p) => ({ timeMs: Date.parse(`${p.t.replace(' ', 'T')}Z`), heightM: Number(p.v), high: p.type === 'H' }));
  let maxT = 0;
  let maxH = 0;
  let hit = 0;
  for (const w of want) {
    let best: (typeof got)[number] | null = null;
    for (const g of got) if (g.high === w.high && (!best || Math.abs(g.timeMs - w.timeMs) < Math.abs(best.timeMs - w.timeMs))) best = g;
    total++;
    if (!best || Math.abs(best.timeMs - w.timeMs) > 3 * 3_600_000) {
      unmatched++;
      continue;
    }
    hit++;
    const t = Math.abs(best.timeMs - w.timeMs) / 60_000;
    const h = Math.abs(best.heightM - w.heightM) * 100;
    dt.push(t);
    dh.push(h);
    maxT = Math.max(maxT, t);
    maxH = Math.max(maxH, h);
  }
  const extra = got.length - hit;
  unmatched += Math.max(0, extra);
  console.log(`| ${sub.name} (${sub.id}) | ${row[9] === 'R' ? 'ratio' : 'feet'} vs ${sub.refId} | ${want.length} | ${hit}${extra > 0 ? ` (+${extra} ours)` : ''} | ${maxT.toFixed(2)} | ${maxH.toFixed(2)} |`);
}
const p95 = (xs: number[]) => xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];
console.log(`\n${sample.length} stations, ${month}: ${dt.length} of ${total} NOAA extremes matched, ${unmatched} unmatched either way`);
console.log(`time error: max ${Math.max(...dt).toFixed(2)} min, p95 ${p95(dt).toFixed(2)} min; height error: max ${Math.max(...dh).toFixed(2)} cm, p95 ${p95(dh).toFixed(2)} cm`);
