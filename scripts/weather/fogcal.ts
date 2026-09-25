/**
 * Scores the fog signs in src/lib/core/weather/fog.ts against METAR fog/mist, and grid-searches their thresholds.
 *   bun scripts/weather/fogcal.ts fetch <dir>   # IEM ASOS METARs + Open-Meteo historical forecasts, cached per station
 *   bun scripts/weather/fogcal.ts score <dir>
 * Truth per UTC hour: any METAR within ±30 min reporting FG, or BR or visibility < 1 km without rain/snow.
 * Scored on photo hours: sunrise −60…+90 min and sunset −90…+60 min. Fits on even days, reports odd days too.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Body, Observer, SearchRiseSet } from 'astronomy-engine';
import { FOG_CLASS_TEXT, FogClass, fogSigns } from '../../src/lib/core/weather/fog';

const START = '2025-09-01';
const END = '2026-08-31';
const UA = 'scape-fogcal/1 (offline threshold calibration; one request per station)';
const VARS = ['weather_code', 'visibility', 'temperature_2m', 'dew_point_2m', 'cloud_cover_low', 'wind_speed_10m'];
const OM = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
const IEM = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';

const Kind = { Coastal: 'Coastal', Valley: 'Valley', Dry: 'Dry' } as const;
type Kind = (typeof Kind)[keyof typeof Kind];
const STATIONS: { id: string; kind: Kind; name: string }[] = [
  { id: 'SFO', kind: Kind.Coastal, name: 'San Francisco' },
  { id: 'HAF', kind: Kind.Coastal, name: 'Half Moon Bay' },
  { id: 'MRY', kind: Kind.Coastal, name: 'Monterey' },
  { id: 'ACV', kind: Kind.Coastal, name: 'Arcata' },
  { id: 'BGR', kind: Kind.Coastal, name: 'Bangor' },
  { id: 'BHB', kind: Kind.Coastal, name: 'Bar Harbor' },
  { id: 'LIML', kind: Kind.Valley, name: 'Milan Linate' },
  { id: 'LIPE', kind: Kind.Valley, name: 'Bologna' },
  { id: 'LIPX', kind: Kind.Valley, name: 'Verona' },
  { id: 'FAT', kind: Kind.Valley, name: 'Fresno' },
  { id: 'SCK', kind: Kind.Valley, name: 'Stockton' },
  { id: 'MCE', kind: Kind.Valley, name: 'Merced' },
  { id: 'POU', kind: Kind.Valley, name: 'Poughkeepsie' },
  { id: 'SWF', kind: Kind.Valley, name: 'Newburgh' },
  { id: 'PHX', kind: Kind.Dry, name: 'Phoenix' },
  { id: 'LAS', kind: Kind.Dry, name: 'Las Vegas' },
  { id: 'TUS', kind: Kind.Dry, name: 'Tucson' },
  { id: 'ELP', kind: Kind.Dry, name: 'El Paso' }
];

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const [mode, dir] = process.argv.slice(2);
if (!dir || (mode !== 'fetch' && mode !== 'score')) {
  console.error('usage: bun scripts/weather/fogcal.ts fetch|score <dir>');
  process.exit(1);
}

function curl(url: string, file: string) {
  if (existsSync(file)) return;
  const r = Bun.spawnSync(['curl', '-sSf', '--retry', '3', '--retry-delay', '20', '-A', UA, '-o', file, url], { stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) throw new Error(`curl failed ${r.exitCode}: ${url}`);
  Bun.sleepSync(3000);
}

const metarFile = (id: string) => join(dir, `${id}.metar.csv`);
const omFile = (id: string) => join(dir, `${id}.om.json`);

function stationLatLng(id: string): { lat: number; lng: number } {
  const row = readFileSync(metarFile(id), 'utf8').split('\n')[1].split(',');
  return { lng: Number(row[2]), lat: Number(row[3]) };
}

if (mode === 'fetch') {
  mkdirSync(dir, { recursive: true });
  const [y1, m1, d1] = START.split('-');
  const [y2, m2, d2] = END.split('-');
  for (const s of STATIONS) {
    const q = `station=${s.id}&data=vsby&data=wxcodes&year1=${y1}&month1=${+m1}&day1=${+d1}&year2=${y2}&month2=${+m2}&day2=${+d2}&tz=Etc/UTC&format=onlycomma&latlon=yes&missing=M&trace=T&report_type=3&report_type=4`;
    curl(`${IEM}?${q}`, metarFile(s.id));
    const p = stationLatLng(s.id);
    const om = `${OM}?latitude=${p.lat.toFixed(3)}&longitude=${p.lng.toFixed(3)}&hourly=${VARS.join(',')}&models=best_match&timezone=GMT&cell_selection=nearest&start_date=${START}&end_date=${END}`;
    curl(om, omFile(s.id));
    console.log(`${s.id} ok`);
  }
  process.exit(0);
}

interface Row {
  station: number;
  kind: Kind;
  even: boolean;
  fogMist: boolean;
  fog: boolean;
  code: number;
  vis: number;
  spread: number;
  low: number;
  wind: number;
}

/** Hour → [fog or mist, dense fog]; hours with no report are absent. */
function truth(id: string): Map<number, [boolean, boolean]> {
  const out = new Map<number, [boolean, boolean]>();
  for (const line of readFileSync(metarFile(id), 'utf8').split('\n').slice(1)) {
    const [, valid, , , vsby, wx = ''] = line.split(',');
    if (!valid) continue;
    const t = Date.parse(`${valid.replace(' ', 'T')}:00Z`);
    const hour = Math.round(t / HOUR_MS) * HOUR_MS;
    const visKm = vsby === 'M' ? NaN : Number(vsby) * 1.609;
    const codes = wx === 'M' ? [] : wx.split(' ');
    const precip = codes.some((c) => /RA|SN|PL|GR|GS|SG|UP/.test(c) && !/DZ/.test(c));
    const fg = codes.some((c) => /FG/.test(c) && !/^(MI|BC|PR|VC)/.test(c));
    const br = codes.includes('BR') && !precip;
    const low = visKm < 1 && !precip;
    const prev = out.get(hour) ?? [false, false];
    const known = !Number.isNaN(visKm) || codes.length > 0;
    if (known || out.has(hour)) out.set(hour, [prev[0] || fg || br || low, prev[1] || fg || low]);
  }
  return out;
}

/** Photo-hour UTC slots around each sunrise and sunset. */
function photoHours(lat: number, lng: number, startMs: number, endMs: number): Set<number> {
  const obs = new Observer(lat, lng, 0);
  const out = new Set<number>();
  const add = (from: number, to: number) => {
    for (let h = Math.ceil(from / HOUR_MS) * HOUR_MS; h <= to; h += HOUR_MS) out.add(h);
  };
  for (let t = startMs; t < endMs; t += 24 * HOUR_MS) {
    const rise = SearchRiseSet(Body.Sun, obs, +1, new Date(t), 1);
    const set = SearchRiseSet(Body.Sun, obs, -1, new Date(t), 1);
    if (rise) add(rise.date.getTime() - 60 * MIN_MS, rise.date.getTime() + 90 * MIN_MS);
    if (set) add(set.date.getTime() - 90 * MIN_MS, set.date.getTime() + 60 * MIN_MS);
  }
  return out;
}

function load(): Row[] {
  const rows: Row[] = [];
  STATIONS.forEach((s, station) => {
    const om = JSON.parse(readFileSync(omFile(s.id), 'utf8')) as { latitude: number; longitude: number; hourly: Record<string, (number | null)[]> & { time: string[] } };
    const h = om.hourly;
    const num = (k: string, i: number) => h[k][i] ?? NaN;
    const tr = truth(s.id);
    const times = h.time.map((t) => Date.parse(`${t}:00Z`));
    const photo = photoHours(om.latitude, om.longitude, times[0], times[times.length - 1] + HOUR_MS);
    times.forEach((t, i) => {
      const obs = tr.get(t);
      if (!obs || !photo.has(t)) return;
      const r: Row = {
        station,
        kind: s.kind,
        even: Math.floor(t / (24 * HOUR_MS)) % 2 === 0,
        fogMist: obs[0],
        fog: obs[1],
        code: num('weather_code', i),
        vis: num('visibility', i),
        spread: num('temperature_2m', i) - num('dew_point_2m', i),
        low: num('cloud_cover_low', i),
        wind: num('wind_speed_10m', i)
      };
      if (!Number.isNaN(r.code) || !Number.isNaN(r.vis)) rows.push(r);
    });
  });
  return rows;
}

interface Rule {
  code: boolean;
  vis: number;
  spread: number;
  low: number;
  wind: number;
}
const fires = (r: Rule, x: Row) =>
  (r.code && (x.code === 45 || x.code === 48)) || x.vis < r.vis || (x.spread < r.spread && x.low >= r.low && x.wind < r.wind);

interface Score {
  hits: number;
  miss: number;
  fa: number;
  pod: number;
  precision: number;
  csi: number;
  f1: number;
}
function score(rows: readonly Row[], pred: (x: Row) => boolean, want: (x: Row) => boolean): Score {
  let hits = 0;
  let miss = 0;
  let fa = 0;
  for (const x of rows) {
    const p = pred(x);
    const o = want(x);
    if (p && o) hits++;
    else if (o) miss++;
    else if (p) fa++;
  }
  const pod = hits / (hits + miss || 1);
  const precision = hits / (hits + fa || 1);
  return { hits, miss, fa, pod, precision, csi: hits / (hits + miss + fa || 1), f1: (2 * precision * pod) / (precision + pod || 1) };
}
const fbeta = (s: Score, b: number) => ((1 + b * b) * s.precision * s.pod) / (b * b * s.precision + s.pod || 1);

const rows = load();
const Target = { FogMist: 'fog or mist', Fog: 'dense fog (FG or < 1 km)' } as const;
const targets = [
  { name: Target.FogMist, want: (x: Row) => x.fogMist },
  { name: Target.Fog, want: (x: Row) => x.fog }
];
const OLD: Rule = { code: true, vis: 1000, spread: 1, low: 50, wind: Infinity };
const classOf = (x: Row, blind?: FogClass, noVis = false) =>
  fogSigns({ code: x.code, visibilityM: noVis ? NaN : x.vis, tempC: x.spread, dewC: 0, lowCloud: x.low }, blind).cls;
const now = (x: Row) => classOf(x) !== FogClass.None;

const only = (r: Partial<Rule>): Rule => ({ code: false, vis: 0, spread: 0, low: 0, wind: Infinity, ...r });

const grid: Rule[] = [];
for (const code of [true, false])
  for (const vis of [0, 1000, 2000, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 7000, 8000])
    for (const spread of [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3])
      for (const low of [0, 25, 50, 60, 70, 75, 80, 85, 90, 95])
        for (const wind of [Infinity, 5, 8, 12, 16, 20]) grid.push({ code, vis, spread, low, wind });

const pct = (v: number) => `${(v * 100).toFixed(0)}%`.padStart(4);
const line = (label: string, s: Score) =>
  `${label.padEnd(56)} POD ${pct(s.pod)}  precision ${pct(s.precision)}  CSI ${s.csi.toFixed(3)}  F1 ${s.f1.toFixed(3)}  (${s.hits} hit ${s.miss} miss ${s.fa} false)`;
const ruleText = (r: Rule) =>
  `${r.code ? 'code 45/48 | ' : ''}vis < ${r.vis} m | spread < ${r.spread} °C & low ≥ ${r.low}%${r.wind < Infinity ? ` & wind < ${r.wind} km/h` : ''}`;

console.log(`${rows.length} photo hours with both a METAR and a forecast, ${START} … ${END}, best_match`);
for (const kind of Object.values(Kind)) {
  const k = rows.filter((x) => x.kind === kind);
  console.log(`  ${kind}: ${k.length} h, fog or mist ${pct(k.filter((x) => x.fogMist).length / k.length)}, dense ${pct(k.filter((x) => x.fog).length / k.length)}`);
}
for (const t of targets) {
  console.log(`\n== truth: ${t.name} ==`);
  const train = rows.filter((x) => x.even);
  const test = rows.filter((x) => !x.even);
  const fit = (metric: (s: Score) => number) => {
    let best = grid[0];
    let bestV = -1;
    for (const r of grid) {
      const v = metric(score(train, (x) => fires(r, x), t.want));
      if (v > bestV) [best, bestV] = [r, v];
    }
    return best;
  };
  const bestCsi = fit((s) => s.csi);
  const bestF2 = fit((s) => fbeta(s, 2));
  const bestF05 = fit((s) => fbeta(s, 0.5));
  for (const [label, set] of [
    ['all days', rows],
    ['test days', test]
  ] as const) {
    console.log(line(`old (vis < 1 km, spread < 1 °C & low ≥ 50%), ${label}`, score(set, (x) => fires(OLD, x), t.want)));
    console.log(line(`fog.ts now, ${label}`, score(set, now, t.want)));
  }
  for (const [label, r] of [
    ['best CSI', bestCsi],
    ['best F2 (recall-weighted)', bestF2],
    ['best F0.5 (precision-weighted)', bestF05]
  ] as const) {
    console.log(`${label}: ${ruleText(r)}`);
    console.log(line('  train (even days)', score(train, (x) => fires(r, x), t.want)));
    console.log(line('  test  (odd days)', score(test, (x) => fires(r, x), t.want)));
  }
  console.log('by signal on test days:');
  for (const [label, r] of [
    ['  code 45/48 only', only({ code: true })],
    ['  vis < 1000 only', only({ vis: 1000 })],
    [`  vis < ${bestCsi.vis} only`, only({ vis: bestCsi.vis })],
    ['  old spread sign only', only({ spread: 1, low: 50 })],
    ['  best spread sign only', only({ spread: bestCsi.spread, low: bestCsi.low, wind: bestCsi.wind })]
  ] as const)
    console.log(line(label, score(test, (x) => fires(r, x), t.want)));
  console.log('by station kind on test days (old → best CSI):');
  for (const kind of Object.values(Kind)) {
    const k = test.filter((x) => x.kind === kind);
    console.log(line(`  ${kind} old`, score(k, (x) => fires(OLD, x), t.want)));
    console.log(line(`  ${kind} new`, score(k, (x) => fires(bestCsi, x), t.want)));
  }
  console.log('by station on test days, CSI old → new:');
  console.log(
    STATIONS.map((s, i) => {
      const k = test.filter((x) => x.station === i);
      const f = (r: Rule) => score(k, (x) => fires(r, x), t.want).csi.toFixed(2);
      return `  ${s.id} ${f(OLD)} → ${f(bestCsi)}`;
    }).join('\n')
  );
}

// Mist and fog scored as separate classes: METAR fog is FG or < 1 km, mist is BR the rest.
const truthClass = (x: Row) => (x.fog ? FogClass.Fog : x.fogMist ? FogClass.Mist : FogClass.None);
console.log('\n== classes: fog.ts Mist and Fog, each against its own METAR class ==');
for (const [label, set] of [
  ['all days', rows],
  ['test days', rows.filter((x) => !x.even)]
] as const)
  for (const [how, blind, noVis] of [
    ['served visibility', undefined, false],
    ['no visibility, spread → Mist', FogClass.Mist, true],
    ['no visibility, spread → Fog', FogClass.Fog, true]
  ] as const)
    for (const c of [FogClass.Mist, FogClass.Fog])
      console.log(line(`${FOG_CLASS_TEXT[c]}, ${how}, ${label}`, score(set, (x) => classOf(x, blind, noVis) === c, (x) => truthClass(x) === c)));
