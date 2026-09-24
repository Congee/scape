/**
 * Builds the bundled tide station table in public/tides from the NOAA CO-OPS metadata API:
 *   bun scripts/build-tides.ts
 * Harmonic (type R) stations only; subordinate stations are offsets from these and are left out.
 */
import { writeFileSync } from 'node:fs';
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
interface Harcon {
  name: string;
  amplitude: number;
  phase_GMT: number;
}

async function json<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url);
  if (res.ok) return (await res.json()) as T;
  if (attempt >= 3) throw new Error(`${res.status} ${url}`);
  await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  return json(url, attempt + 1);
}

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
  const name = m.state ? `${m.name}, ${m.state}` : m.name;
  return [m.id, name, round4(m.lat), round4(m.lng), Math.round((msl - mllw) * 1000), cs];
}

const list = await json<{ stations: Meta[] }>(`${API}/stations.json?type=tidepredictions`);
const harmonic = list.stations.filter((s) => s.type === 'R');
const rows: Row[] = [];
let skipped = 0;
for (let i = 0; i < harmonic.length; i += 16) {
  // oxlint-disable-next-line no-await-in-loop -- small batches; CO-OPS refuses bursts
  const batch = await Promise.all(harmonic.slice(i, i + 16).map(station));
  for (const r of batch) {
    if (r) rows.push(r);
    else skipped++;
  }
}
rows.sort((a, b) => a[0].localeCompare(b[0]));

const date = new Date().toISOString().slice(0, 10);
const source = `NOAA CO-OPS harmonic constituents and datums, public domain, downloaded ${date}`;
const body = JSON.stringify({ source, constituents: CONSTITUENT_NAMES, stations: rows });
writeFileSync(join(out, 'stations.json'), body);
console.log(`stations: ${rows.length}, skipped without MSL/MLLW: ${skipped}, subordinate left out: ${list.stations.length - harmonic.length}, ${body.length} bytes`);
