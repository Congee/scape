/**
 * Builds the bundled tide station tables in public/tides from the NOAA CO-OPS metadata API:
 *   bun scripts/build-tides.ts [--subordinate]
 * Harmonic (type R) stations go to stations.json; subordinate (type S) stations, as high/low offsets
 * from one of those, go to subordinate.json. `--subordinate` rebuilds only that, against the bundled stations.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSTITUENT_NAMES } from '../src/lib/core/tides/constituents';

const API = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi';
const out = join(import.meta.dir, '../public/tides');
// Below a millimetre a constituent moves nothing a photographer would see.
const MIN_AMP_MM = 1;
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

interface Meta {
  id: string;
  name: string;
  lat: number;
  lng: number;
  state: string;
  type: string;
}
interface Offsets {
  refStationId: string;
  heightOffsetHighTide: number | null;
  heightOffsetLowTide: number | null;
  timeOffsetHighTide: number | null;
  timeOffsetLowTide: number | null;
  heightAdjustedType: string;
}
interface Harcon {
  name: string;
  amplitude: number;
  phase_GMT: number;
}

async function json<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url);
  if (res.ok) return (await res.json()) as T;
  if (attempt >= 5) throw new Error(`${res.status} ${url}`);
  // CO-OPS answers a burst with 403 for a minute or more.
  await new Promise((r) => setTimeout(r, (res.status === 403 ? 30_000 : 1000) * 2 ** attempt));
  return json(url, attempt + 1);
}

const label = (m: Meta) => (m.state ? `${m.name}, ${m.state}` : m.name);

type Row = [id: string, name: string, lat: number, lng: number, z0Mm: number, constituents: number[]];

async function station(m: Meta): Promise<Row | null> {
  const [h, d] = await Promise.all([
    json<{ HarmonicConstituents: Harcon[] }>(`${API}/stations/${m.id}/harcon.json?units=metric`),
    json<{ datums?: { name: string; value: number }[] }>(`${API}/stations/${m.id}/datums.json?units=metric`)
  ]);
  const datum = (n: string) => d.datums?.find((x) => x.name === n)?.value;
  const msl = datum('MSL');
  const mllw = datum('MLLW');
  if (msl === undefined || mllw === undefined || !h.HarmonicConstituents?.length) return null;
  const cs: number[] = [];
  for (const c of h.HarmonicConstituents) {
    const i = CONSTITUENT_NAMES.indexOf(c.name);
    const amp = Math.round(c.amplitude * 1000);
    if (i < 0 || amp < MIN_AMP_MM) continue;
    cs.push(i, amp, Math.round(c.phase_GMT * 10));
  }
  return [m.id, label(m), round4(m.lat), round4(m.lng), Math.round((msl - mllw) * 1000), cs];
}

type SubRow = [id: string, name: string, lat: number, lng: number, refId: string, highMin: number, lowMin: number, highH: number, lowH: number, kind: string];

// R: heights are the reference's times a ratio; F: plus an offset in feet.
const HEIGHT_KINDS = new Set(['R', 'F']);

async function subordinate(m: Meta): Promise<SubRow | null> {
  const o = await json<Offsets>(`${API}/stations/${m.id}/tidepredoffsets.json`);
  const { heightOffsetHighTide: hh, heightOffsetLowTide: lh, timeOffsetHighTide: ht, timeOffsetLowTide: lt } = o;
  if (hh === null || lh === null || ht === null || lt === null || !o.refStationId) return null;
  if (!HEIGHT_KINDS.has(o.heightAdjustedType)) throw new Error(`${m.id}: unknown heightAdjustedType ${o.heightAdjustedType}`);
  return [m.id, label(m), round4(m.lat), round4(m.lng), o.refStationId, ht, lt, hh, lh, o.heightAdjustedType];
}

async function batched<T>(items: Meta[], fn: (m: Meta) => Promise<T | null>): Promise<{ rows: T[]; skipped: string[] }> {
  const rows: T[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < items.length; i += 8) {
    const slice = items.slice(i, i + 8);
    // oxlint-disable-next-line no-await-in-loop -- small batches; CO-OPS refuses bursts
    const batch = await Promise.all(slice.map(fn));
    // oxlint-disable-next-line no-await-in-loop -- a pause between batches keeps CO-OPS from blocking the run
    await new Promise((r) => setTimeout(r, 250));
    batch.forEach((r, j) => (r ? rows.push(r) : skipped.push(slice[j].id)));
  }
  return { rows, skipped };
}

const list = await json<{ stations: Meta[] }>(`${API}/stations.json?type=tidepredictions`);
const date = new Date().toISOString().slice(0, 10);

let rows: Row[];
if (process.argv.includes('--subordinate')) rows = (JSON.parse(readFileSync(join(out, 'stations.json'), 'utf8')) as { stations: Row[] }).stations;
else {
  const harmonic = await batched(
    list.stations.filter((s) => s.type === 'R'),
    station
  );
  rows = harmonic.rows.toSorted((a, b) => a[0].localeCompare(b[0]));
  const source = `NOAA CO-OPS harmonic constituents and datums, public domain, downloaded ${date}`;
  const body = JSON.stringify({ source, constituents: CONSTITUENT_NAMES, stations: rows });
  writeFileSync(join(out, 'stations.json'), body);
  console.log(`harmonic: ${rows.length}, skipped without MSL/MLLW: ${harmonic.skipped.length}, ${body.length} bytes`);
}

const sub = await batched(
  list.stations.filter((s) => s.type === 'S'),
  subordinate
);
const refs = new Set(rows.map((r) => r[0]));
const subRows = sub.rows.filter((r) => refs.has(r[4])).toSorted((a, b) => a[0].localeCompare(b[0]));
const subSource = `NOAA CO-OPS subordinate station high/low offsets, public domain, downloaded ${date}`;
const subBody = JSON.stringify({ source: subSource, stations: subRows });
writeFileSync(join(out, 'subordinate.json'), subBody);
console.log(`subordinate: ${subRows.length}, skipped without offsets: ${sub.skipped.length}, without a bundled reference: ${sub.rows.length - subRows.length}, ${subBody.length} bytes`);
