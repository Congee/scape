// GIBS far-night smoke: a cold point fetches z8 tiles on all nights and z6 on the far nights only; readout, idle; desktop and phone.
// Usage: bun scripts/smoke/gibsfar.ts <cdp> <dev-port> <shot-dir>
/* oxlint-disable no-await-in-loop -- CDP steps are sequential */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { GIBS_FAR_NIGHTS, GIBS_FAR_ZOOM, GIBS_NEAR_ZOOM, GIBS_NIGHTS, gibsFarNights, gibsNights } from '../../src/lib/core/sky/gibs';
import { Tab } from './cdp';

const [cdp = '9473', port = '5473', shots = '/tmp/gibsfar'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });

const WHEN = '2026-10-26T21:00Z';
const SITES = {
  cherry: { camera: { lat: 41.6626, lng: -77.8261 }, target: { lat: 41.67, lng: -77.8 } },
  potsdam: { camera: { lat: 52.3833, lng: 13.0942 }, target: { lat: 52.4, lng: 13.12 } }
} as const;
type Site = keyof typeof SITES;
const url = (s: Site) => `${BASE}/viewfinder?camera=${SITES[s].camera.lat},${SITES[s].camera.lng}&target=${SITES[s].target.lat},${SITES[s].target.lng}&t=${WHEN}&f=24`;
const READOUT = new RegExp(`^Sky ≈ \\d{2}\\.\\d mag/arcsec² · Bortle ≈ [1-9](–9)? · VIIRS nightly, ${GIBS_NIGHTS} nights to (\\d{4}-\\d\\d-\\d\\d)`);
const TILE = /gibs\.earthdata\.nasa\.gov\/.*\/default\/(\d{4}-\d\d-\d\d)\/GoogleMapsCompatible_Level8\/(\d+)\/(\d+)\/(\d+)\.png/;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail.replaceAll('|', '/')} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
const ev = <T>(e: string) => tab.eval<T>(e);
const go = async (u: string) => {
  await tab.navigate(u);
  await tab.until('!!window.__scape?.offline.getState().loaded', 60_000);
};
const openNight = () =>
  ev(`(async () => {
  const u = window.__scape.ui; u.getState().setPanelTab('Sky'); u.setState({ panelCollapsed: false });
  for (let i = 0; i < 40 && !document.querySelector('[data-sky]'); i++) await new Promise((r) => setTimeout(r, 100));
  const d = document.querySelector('[data-sky]')?.closest('details'); if (!d) return false;
  d.open = true; d.scrollIntoView({ block: 'start' }); return true;
})()`);
const ready = async () => {
  const ok = await tab.until(`(() => { const g = window.__scape.skyglow.getState(); return g.camera.status === 'Ready' && g.target.status === 'Ready'; })()`, 120_000);
  await Bun.sleep(700);
  return !!ok;
};
const clearCache = () => ev(`navigator.storage.getDirectory().then((d) => d.removeEntry('gibs', { recursive: true })).catch(() => {})`);

await tab.fresh(BASE);
await go(url('cherry'));
await ev('window.__scape.offline.getState().removeViirs()');

for (const [view, w, h, s] of [['desktop', 1400, 900, 'cherry'], ['phone', 390, 844, 'potsdam']] as const) {
  await tab.viewport(w, h);
  await go(url(s));
  await clearCache();
  await tab.logRequests();
  await tab.reload();
  await tab.until('!!window.__scape?.offline.getState().loaded', 60_000);
  await openNight();
  const ok = await ready();
  const cam = await ev<string>(`document.querySelector('.sky-readout[data-sky="Camera"]')?.textContent.trim() ?? ''`);
  await tab.shot(join(shots, `${view}-${s}.png`));
  const m = cam.match(READOUT);
  const newest = m?.[2] ?? '';
  const dates = gibsNights(newest);
  const far = new Set(gibsFarNights().map((i) => dates[i]));
  const tiles = [...new Set(tab.requests.map((u) => u.match(TILE)).filter((x) => !!x).map((x) => x.slice(1).join('/')))].map((k) => k.split('/'));
  const inSet = tiles.filter(([d]) => dates.includes(d));
  const nearReq = inSet.filter(([, z]) => Number(z) === GIBS_NEAR_ZOOM);
  const farReq = inSet.filter(([, z]) => Number(z) === GIBS_FAR_ZOOM);
  const farTiles = new Set(farReq.map(([, ...t]) => t.join('/'))).size;
  const nearTiles = new Set(nearReq.map(([, ...t]) => t.join('/'))).size;
  const probes = tiles.length - inSet.length;
  const was = GIBS_NIGHTS * (nearTiles + farTiles);
  check(`${view} ${s}: cold readout`, ok && !!m && (await ev<boolean>('document.documentElement.scrollWidth <= innerWidth')), cam.split(' · More')[0]);
  check(
    `${view} ${s}: z6 only on the ${GIBS_FAR_NIGHTS} far nights`,
    farReq.every(([d]) => far.has(d)) && farReq.length === GIBS_FAR_NIGHTS * farTiles && nearReq.length === GIBS_NIGHTS * nearTiles,
    `${nearReq.length} z8 (${nearTiles}×${GIBS_NIGHTS}) + ${farReq.length} z6 (${farTiles}×${GIBS_FAR_NIGHTS}) = ${inSet.length} tile requests, was ${was} (−${(100 * (1 - inSet.length / was)).toFixed(0)} %); ${probes} probe misses`
  );
}

// Idle after the reading.
for (const t0 = Date.now(); Date.now() - t0 < 30_000; ) {
  await ev('window.__scape.idle.reset()');
  await Bun.sleep(1000);
  if ((await ev<number>('window.__scape.idle.glDraws')) === 0) break;
}
await ev('window.__scape.idle.reset()');
await tab.logRequests();
const r0 = await ev<number>('window.__scape.skyglow.getState().runs');
await Bun.sleep(3000);
const idle = await ev<{ raf: number; glDraws: number }>('(({ raf, glDraws }) => ({ raf, glDraws }))(window.__scape.idle)');
const runs = (await ev<number>('window.__scape.skyglow.getState().runs')) - r0;
const gibs = tab.requests.filter((u) => TILE.test(u)).length;
check('Idle 3 s: 0 rAF, 0 GL draws, 0 sky runs, 0 GIBS requests', idle.raf === 0 && idle.glDraws === 0 && runs === 0 && gibs === 0, `rAF ${idle.raf}, GL ${idle.glDraws}, runs ${runs}, GIBS ${gibs}`);

await clearCache();
console.log('| Check | Result | Detail |');
console.log('|---|---|---|');
console.log(rows.join('\n'));
tab.close();
process.exit(failed ? 1 : 0);
