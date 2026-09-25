// Hidden buildings fetch and redraw nothing on a cold viewfinder; showing them again loads them.
/* oxlint-disable no-await-in-loop -- cases run in order */
// Usage: bun scripts/smoke/coldtiles.ts <cdp> <port> [screenshot-dir]
import { Tab } from './cdp';

const [cdp = '9610', port = '5610', shots = `${process.env.TMPDIR ?? '/tmp'}/coldtiles`] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
// Rotterdam: Overture and 3DBAG both stream here.
const URL_VF = `${BASE}/viewfinder?camera=51.9091,4.4868&target=51.90664,4.48805&t=2026-06-21T13:00Z&f=35`;
const WATCH_MS = 15_000;
const isBuildingUrl = (u: string) => u.includes('buildings.pmtiles') || u.includes('3dbag.nl') || u.includes('swissbuildings3d') || u.includes('plateau');

const Case = { ColdHidden: 'cold, hidden before load', HideEarly: 'hidden while streaming', TerrainOff: 'terrain off while streaming' } as const;
type Case = (typeof Case)[keyof typeof Case];

const tab = await Tab.open(Number(cdp), BASE);
await tab.viewport(1400, 900, 2);
const rows: string[] = [];
let fail = false;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) fail = true;
};
const js = <T = unknown>(body: string) => tab.eval<T>(`(async () => { const S = window.__scape; const imp = (p) => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === p) ?? p); ${body} })()`);
const building = () => tab.requests.filter(isBuildingUrl).length;
/** Store versions: each bump schedules a viewfinder redraw. */
const versions = () => js<{ b: number; l: number; tiles: number; lod2: number; busy: boolean }>(`const L = (await imp('/src/lib/state/lod2.ts')).lod2Store.getState(), B = S.buildings.getState(); return { b: B.version, l: L.version, tiles: B.tiles.size, lod2: L.tiles.size, busy: B.busy || L.busy };`);

async function run(c: Case) {
  await tab.fresh(BASE);
  if (c === Case.ColdHidden) {
    await tab.navigate(`${BASE}/robots.txt`);
    await tab.eval(`import('/src/lib/state/composition.ts').then((m) => { m.compositionStore.getState().update({ showBuildings: false }); return true; })`);
  }
  await tab.logRequests();
  await tab.navigate(URL_VF);
  await tab.until('window.__scape?.idle', 30_000, 200);
  if (c !== Case.ColdHidden) {
    // Hide once the first tile is on the wire, as a user toggling on a cold page would.
    for (let i = 0; i < 600 && building() === 0; i++) await Bun.sleep(50);
    const seen = building() > 0;
    await js(c === Case.HideEarly ? 'S.composition.getState().update({ showBuildings: false }); return true;' : 'S.settings.getState().update({ terrain: false }); return true;');
    if (!seen) check(`${c}: tiles were streaming`, false, 'no building request before the hide');
  }
  // A request already on the wire may land; nothing new may start after this.
  await Bun.sleep(1000);
  const req0 = building();
  const v0 = await versions();
  await js('S.idle.reset(); return true;');
  await Bun.sleep(WATCH_MS);
  const req1 = building();
  const v1 = await versions();
  const frames = await js<number>('return S.idle.glFrames;');
  const bumps = v1.b - v0.b + (v1.l - v0.l);
  check(`${c}: no building fetch while hidden`, req1 - req0 === 0 && (c !== Case.ColdHidden || req1 === 0), `${req0} before the watch, ${req1 - req0} during ${WATCH_MS / 1000} s`);
  check(`${c}: no building redraw while hidden`, bumps === 0 && !v1.busy, `${bumps} store bumps, busy ${v1.busy}, ${frames} GL frames in ${WATCH_MS / 1000} s`);
  console.error(JSON.stringify({ c, req0, req1, v0, v1, frames, during: tab.requests.filter(isBuildingUrl).slice(req0).map((u) => u.slice(-60)) }));

  await js(c === Case.TerrainOff ? 'S.settings.getState().update({ terrain: true }); return true;' : 'S.composition.getState().update({ showBuildings: true }); return true;');
  let v2 = await versions();
  for (let end = Date.now() + 90_000; Date.now() < end && (v2.busy || v2.tiles === 0 || v2.lod2 === 0); v2 = await versions()) await Bun.sleep(500);
  const shown = !v2.busy && v2.tiles > 0 && v2.lod2 > 0;
  await tab.shot(`${shots}/${c.replaceAll(/[^a-z]+/g, '-')}-shown.png`);
  check(`${c}: shown again, buildings load`, !!shown, `${v2.tiles} Overture tiles, ${v2.lod2} LoD2 tiles, ${building() - req1} requests`);
  tab.stopRequests();
}

await Bun.$`mkdir -p ${shots}`;
for (const c of Object.values(Case)) await run(c);
await tab.send('Emulation.clearDeviceMetricsOverride');
tab.close();
console.log('| check | result | detail |');
console.log('|---|---|---|');
for (const r of rows) console.log(r);
process.exit(fail ? 1 : 0);
