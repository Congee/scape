// GIBS live smoke: runtime VIIRS nightly tiles at three sites, loading, idle with the Night tab closed, OPFS reuse, cached and uncached offline, a server error, desktop and phone.
// Usage: bun scripts/smoke/gibslive.ts <cdp> <dev-port> <shot-dir>
/* oxlint-disable no-await-in-loop -- CDP steps are sequential */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Tab } from './cdp';

const [cdp = '9467', port = '5467', shots = '/tmp/gibslive'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });

const WHEN = '2026-10-26T21:00Z';
// Bortle ranges from gibs.md: Cherry Springs is a Bortle 2 site, Potsdam-Babelsberg reads SQM 20.3 (model 19.1), Rotterdam is a city.
const SITES = {
  cherry: { camera: { lat: 41.6626, lng: -77.8261 }, target: { lat: 41.67, lng: -77.8 }, bortle: [1, 3] },
  potsdam: { camera: { lat: 52.3833, lng: 13.0942 }, target: { lat: 52.4, lng: 13.12 }, bortle: [4, 7] },
  rotterdam: { camera: { lat: 51.9091, lng: 4.4868 }, target: { lat: 51.90664, lng: 4.48805 }, bortle: [7, 9] }
} as const;
type Site = keyof typeof SITES;
const url = (s: Site) => `${BASE}/viewfinder?camera=${SITES[s].camera.lat},${SITES[s].camera.lng}&target=${SITES[s].target.lat},${SITES[s].target.lng}&t=${WHEN}&f=24`;

const READOUT = /^Sky ≈ \d{2}\.\d mag\/arcsec² · Bortle ≈ ([1-9])(–9)? · VIIRS nightly, (\d) nights? to (\d{4}-\d\d-\d\d)/;
const GIBS = 'gibs.earthdata.nasa.gov';

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

const status = (s: string) => `(() => { const g = window.__scape.skyglow.getState(); return g.camera.status === '${s}' && g.target.status === '${s}'; })()`;
const settle = async (s: string, ms = 120_000) => {
  const ok = await tab.until(status(s), ms);
  await Bun.sleep(700);
  return !!ok;
};
const noSideways = () => ev<boolean>('document.documentElement.scrollWidth <= innerWidth');
const text = (sel: string) => ev<string>(`document.querySelector('${sel}')?.textContent.trim() ?? ''`);
type Last = { tiles: number; fetchedTiles: number; fetchedBytes: number; nights: string[] };
const last = () => ev<Partial<Record<'camera' | 'target', Last>>>('window.__scape.skyglow.getState().gibsLast');
const gibsRequests = () => tab.requests.filter((u) => u.includes(GIBS)).length;
// The dev server must stay reachable, so only GIBS goes dark: failed as disconnected, or answered 503.
let block: 'none' | 'offline' | '503' = 'none';
tab.listeners.push((method, p, sessionId) => {
  if (method !== 'Fetch.requestPaused') return;
  const id = p.requestId;
  if (block === 'offline') void tab.send('Fetch.failRequest', { requestId: id, errorReason: 'InternetDisconnected' }, sessionId).catch(() => {});
  else if (block === '503') void tab.send('Fetch.fulfillRequest', { requestId: id, responseCode: 503, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }, sessionId).catch(() => {});
  else void tab.send('Fetch.continueRequest', { requestId: id }, sessionId).catch(() => {});
});
const pattern = { patterns: [{ urlPattern: `*${GIBS}*` }] };
tab.workerSetup.push((s) => tab.send('Fetch.enable', pattern, s).catch(() => {}));
await tab.send('Fetch.enable', pattern);
const clearCache = () => ev(`navigator.storage.getDirectory().then((d) => d.removeEntry('gibs', { recursive: true })).catch(() => {})`);

// 0. Clean slate: no imported years, no cached nights, default panel.
await tab.viewport(1400, 900);
await tab.fresh(BASE);
await go(url('cherry'));
await ev('window.__scape.offline.getState().removeViirs()');
await clearCache();

// 1. Night tab closed: no demand, no GIBS traffic.
await tab.logRequests();
await go(url('cherry'));
await Bun.sleep(3000);
const idleStatus = await ev<string>('window.__scape.skyglow.getState().camera.status');
const tabNow = await ev<string>('window.__scape.ui.getState().panelTab');
check('Sky tab closed: sky Idle, no GIBS requests', idleStatus === 'Idle' && tabNow !== 'Sky' && gibsRequests() === 0, `tab ${tabNow}, status ${idleStatus}, ${gibsRequests()} GIBS requests`);

// 2. Live fetch at each site, desktop.
const bortles: Record<string, number> = {};
for (const s of Object.keys(SITES) as Site[]) {
  await tab.logRequests();
  await go(url(s));
  await openNight();
  const loading = s === 'cherry' ? await tab.until<string>(`document.querySelector('.sky-loading')?.textContent.trim() ?? ''`, 20_000, 50) : 'skipped';
  if (s === 'cherry') await tab.shot(join(shots, 'desktop-loading.png'));
  const ready = await settle('Ready');
  const cam = await text('.sky-readout[data-sky="Camera"]');
  const tgt = await text('.sky-readout[data-sky="Target"]');
  const m = cam.match(READOUT);
  const g = await last();
  await tab.shot(join(shots, `desktop-${s}.png`));
  const [lo, hi] = SITES[s].bortle;
  const b = Number(m?.[1] ?? NaN);
  bortles[s] = b;
  const bytes = (g.camera?.fetchedBytes ?? 0) + (g.target?.fetchedBytes ?? 0);
  if (s === 'cherry') check('Loading row while GIBS fetches', loading === 'loading VIIRS nightly…', loading || 'not seen');
  check(`desktop ${s}: nightly readout, Bortle ${lo}–${hi}`, ready && !!m && READOUT.test(tgt) && b >= lo && b <= hi && (await noSideways()), `${cam.split(' · More')[0]} / target ${tgt.split(' · ')[1] ?? tgt}`);
  check(
    `desktop ${s}: bytes per point`,
    !!g.camera && g.camera.fetchedTiles > 0,
    `camera ${g.camera?.fetchedTiles} of ${g.camera?.tiles}×${g.camera?.nights.length} tiles, ${((g.camera?.fetchedBytes ?? 0) / 1e6).toFixed(2)} MB; target ${g.target?.fetchedTiles} tiles, ${((g.target?.fetchedBytes ?? 0) / 1e6).toFixed(2)} MB; ${gibsRequests()} requests, ${(bytes / 1e6).toFixed(2)} MB`
  );
}
check('Sites order dark < suburb < city', bortles.cherry < bortles.potsdam && bortles.potsdam < bortles.rotterdam, Object.entries(bortles).map(([k, v]) => `${k} ${v}`).join(', '));

// 3. Idle after a reading: no frames, GPU work, runs or requests.
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
const idleRuns = (await ev<number>('window.__scape.skyglow.getState().runs')) - r0;
const others = [...new Set(tab.requests.filter((u) => !u.includes(GIBS)).map((u) => new URL(u).host))].join(' ');
check('Idle 3 s: 0 rAF, 0 GL draws, 0 sky runs, 0 GIBS requests', idle.raf === 0 && idle.glDraws === 0 && idleRuns === 0 && gibsRequests() === 0, `rAF ${idle.raf}, GL draws ${idle.glDraws}, runs ${idleRuns}, GIBS ${gibsRequests()}, other ${tab.requests.length - gibsRequests()} (${others || 'none'})`);

// 4. Phone, reloaded: every tile from OPFS.
await tab.viewport(390, 844);
for (const s of Object.keys(SITES) as Site[]) {
  await tab.logRequests();
  await go(url(s));
  await openNight();
  const ready = await settle('Ready');
  const cam = await text('.sky-readout[data-sky="Camera"]');
  const g = await last();
  await tab.shot(join(shots, `phone-${s}.png`));
  const fits = await noSideways();
  check(`phone ${s}: readout from OPFS, no sideways scroll`, ready && READOUT.test(cam) && g.camera?.fetchedTiles === 0 && gibsRequests() === 0 && fits, `${cam.split(' · More')[0]}; fetched ${g.camera?.fetchedTiles}, ${gibsRequests()} GIBS requests, fits ${fits}`);
}

// 5. Offline with the cache: the same reading, nothing fetched.
for (const v of [
  { name: 'desktop', w: 1400, h: 900 },
  { name: 'phone', w: 390, h: 844 }
]) {
  await tab.viewport(v.w, v.h);
  block = 'offline';
  await go(url('potsdam'));
  await openNight();
  const ready = await settle('Ready');
  const cam = await text('.sky-readout[data-sky="Camera"]');
  await tab.shot(join(shots, `${v.name}-offline-cached.png`));
  check(`${v.name}: offline reload reads the cached nights`, ready && READOUT.test(cam) && (await noSideways()), cam.split(' · More')[0]);
  block = 'none';
}

// 6. Offline without a cache: the missing row with its DarkHours link.
for (const v of [
  { name: 'desktop', w: 1400, h: 900 },
  { name: 'phone', w: 390, h: 844 }
]) {
  await tab.viewport(v.w, v.h);
  block = 'offline';
  await go(url('cherry'));
  await clearCache();
  await tab.reload();
  await tab.until('!!window.__scape?.offline.getState().loaded', 60_000);
  await openNight();
  const ok = await settle('NoData');
  const miss = await text('.sky-missing[data-sky="Camera"]');
  await tab.shot(join(shots, `${v.name}-offline-empty.png`));
  check(`${v.name}: offline, no cache: no sky data here`, ok && miss.includes('no sky data here') && miss.includes('More on DarkHours') && (await noSideways()), miss);
  block = 'none';
}

// 7. GIBS answering 503: the error row.
await tab.viewport(1400, 900);
block = '503';
await go(url('rotterdam'));
await clearCache();
await tab.reload();
await tab.until('!!window.__scape?.offline.getState().loaded', 60_000);
await openNight();
const errOk = await settle('Error');
const err = await text('.sky-error[data-sky="Camera"]');
await tab.shot(join(shots, 'desktop-error.png'));
check('GIBS 503: error row', errOk && /503/.test(err), err || 'no error row');
block = 'none';

await clearCache();
console.log('| Check | Result | Detail |');
console.log('|---|---|---|');
console.log(rows.join('\n'));
tab.close();
process.exit(failed ? 1 : 0);
