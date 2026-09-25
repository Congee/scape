// Bortle smoke: missing state, LAADS listing (stubbed, then one live fetch), synthetic tile import, camera and target readouts at three sites on desktop and phone, one run per pin move, idle frames, GPU vs CPU.
// Usage: bun scripts/smoke/bortle.ts <cdp> <dev-port> <shot-dir> <tile-dir> [gpu-lock-dir|-]
/* oxlint-disable no-await-in-loop -- CDP steps are sequential */
import { mkdirSync, readdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { Tab } from './cdp';

const [cdp = '9444', port = '5444', shots = '/tmp/bortle', tiles = '/tmp/bortle/tiles', lock = '-'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });

const YEAR = 2024;
const WHEN = '2026-10-26T21:00Z'; // Full moon, so the moonlight row has a curve.
const SITES = {
  // Synthetic city lights on Rotterdam.
  rotterdam: { camera: { lat: 51.9091, lng: 4.4868 }, target: { lat: 51.90664, lng: 4.48805 } },
  // Lauwersmeer, far from the synthetic cities.
  rural: { camera: { lat: 53.38, lng: 6.22 }, target: { lat: 53.4, lng: 6.25 } },
  // Zselic, a faint synthetic town 14 km north.
  zselic: { camera: { lat: 46.23, lng: 17.77 }, target: { lat: 46.25, lng: 17.8 } }
} as const;
type Site = keyof typeof SITES;
const url = (s: Site) => `${BASE}/viewfinder?camera=${SITES[s].camera.lat},${SITES[s].camera.lng}&target=${SITES[s].target.lat},${SITES[s].target.lng}&t=${WHEN}&f=24`;

const TOOLTIP = 'Models artificial light only, on a moonless, clear night.';
const READOUT = /^Sky ≈ \d{2}\.\d mag\/arcsec² · Bortle ≈ [1-9](–9)? · VIIRS 2024 model/;
const DARKHOURS = /^https:\/\/darkhours\.app\/\?lat=-?\d+\.\d{5}&lon=-?\d+\.\d{5}&date=2026-10-26$/;
// Stubbed listing: h17v04 left out so the panel shows an ocean chip.
const LISTED = ['h17v03', 'h18v03', 'h18v04', 'h19v03', 'h19v04'];

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail.replaceAll('|', '/')} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
const ev = <T>(e: string) => tab.eval<T>(e);

let stubbed = 0;
tab.listeners.push((method, p) => {
  if (method !== 'Fetch.requestPaused') return;
  stubbed++;
  const body = JSON.stringify({ content: LISTED.map((t) => ({ name: `VNP46A4.A${YEAR}001.${t}.002.2025000000000.h5` })) });
  void tab.send('Fetch.fulfillRequest', {
    requestId: p.requestId,
    responseCode: 200,
    responseHeaders: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Access-Control-Allow-Origin', value: '*' }
    ],
    body: Buffer.from(body).toString('base64')
  });
});
await tab.send('Fetch.enable', { patterns: [{ urlPattern: '*ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VNP46A4/*/001.json*' }] });

const withLock = async <T>(f: () => Promise<T>): Promise<T> => {
  if (lock === '-') return f();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      await Bun.sleep(30_000);
    }
  }
  try {
    return await f();
  } finally {
    rmdirSync(lock);
  }
};

const go = async (u: string) => {
  await tab.navigate(u);
  await tab.until('!!window.__scape?.offline.getState().loaded', 60_000);
};

const pin = (p: { lat: number; lng: number }) => `window.__scape.world.getState().setPin({ lat: ${p.lat}, lng: ${p.lng} })`;

/** Night tab open with the sky group expanded and in view. */
const openNight = () =>
  ev(`(async () => {
  const u = window.__scape.ui; u.getState().setPanelTab('Night'); u.setState({ panelCollapsed: false });
  for (let i = 0; i < 40 && !document.querySelector('[data-sky]'); i++) await new Promise((r) => setTimeout(r, 100));
  const d = document.querySelector('[data-sky]')?.closest('details'); if (!d) return false;
  d.open = true; d.scrollIntoView({ block: 'start' }); return true;
})()`);

const status = (s: string) => `(() => { const g = window.__scape.skyglow.getState(); return g.camera.status === '${s}' && g.target.status === '${s}'; })()`;

/** Waits for a status on both points, then for the debounce to go quiet. */
const settle = async (s: string, ms = 60_000) => {
  const ok = await tab.until(status(s), ms);
  await Bun.sleep(700);
  return !!ok;
};

const noSideways = () => ev<boolean>('document.documentElement.scrollWidth <= innerWidth');

type Point = { text: string; title: string; href: string; target: string; rel: string; domes: string };
const readPoint = (label: string) =>
  ev<Point | null>(`(() => {
  const b = document.querySelector('.sky-readout[data-sky="${label}"]'); if (!b) return null;
  const a = b.querySelector('a.darkhours');
  return { text: b.textContent.trim(), title: b.title, href: a?.href ?? '', target: a?.target ?? '', rel: a?.rel ?? '', domes: b.querySelector('.domes')?.textContent.trim() ?? '' };
})()`);

/** Waits for ground heights and the camera skyline, then for both readouts to hold for 1.5 s. */
const steady = async (ms = 30_000) => {
  await tab.until('(() => { const t = window.__scape.terrain.getState(); return t.pinGroundM != null && t.pin2GroundM != null && !!t.horizon; })()', ms);
  let last = '';
  let same = 0;
  for (const t0 = Date.now(); Date.now() - t0 < ms && same < 3; ) {
    const now = JSON.stringify([await readPoint('Camera'), await readPoint('Target')]);
    same = now === last ? same + 1 : 0;
    last = now;
    await Bun.sleep(500);
  }
};

const views = [
  { name: 'desktop', w: 1400, h: 900 },
  { name: 'phone', w: 390, h: 844 }
] as const;

// 0. A clean slate, whatever an earlier run stored in this profile.
await tab.viewport(1400, 900);
await go(url('rotterdam'));
await ev('window.__scape.offline.getState().removeViirs()');

// 1. Missing state on both viewports.
for (const v of views) {
  await tab.viewport(v.w, v.h);
  await go(url('rotterdam'));
  const ok = await settle('NoData');
  await openNight();
  const m = await ev<{ cam: string; tgt: string; badge: boolean } | null>(`(() => {
    const c = document.querySelector('.sky-missing[data-sky="Camera"]'), t = document.querySelector('.sky-missing[data-sky="Target"]');
    return c && t ? { cam: c.textContent.trim(), tgt: t.textContent.trim(), badge: !!document.querySelector('.sky-badge') } : null;
  })()`);
  await tab.shot(join(shots, `${v.name}-missing.png`));
  const fits = await noSideways();
  check(`${v.name}: missing state for camera and target`, ok && !!m && m.cam.includes('download VIIRS for this region') && m.cam.includes('h18v03') && m.tgt.includes('download VIIRS') && !m.badge && fits, m ? `${m.cam} · badge ${m.badge} · fits ${fits}` : 'no missing rows');
}
await tab.viewport(1400, 900);

// 2. The missing link opens the Offline tab; Check LAADS lists the year from the stub.
await ev(`document.querySelector('.sky-missing[data-sky="Camera"] button').click()`);
const tabNow = await ev<string>('window.__scape.ui.getState().panelTab');
await tab.until(`[...document.querySelectorAll('button')].some((b) => /Check LAADS|Recheck LAADS/.test(b.textContent))`, 20_000);
await ev(`(() => {
  const i = document.querySelector('input[aria-label="VIIRS composite year"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '${YEAR}');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await Bun.sleep(200);
await ev(`[...document.querySelectorAll('button')].find((b) => /Check LAADS|Recheck LAADS/.test(b.textContent)).click()`);
const listed = await tab.until<string>(`(() => { const l = window.__scape.offline.getState().viirs.listings[${YEAR}]; return l ? l.join(' ') : ''; })()`, 20_000);
const chips = await ev<string>(`[...document.querySelectorAll('.viirs-need [data-tile]')].map((c) => c.dataset.tile + ':' + c.className.replace('chip ', '')).join(' ')`);
await tab.shot(join(shots, 'desktop-offline-listing.png'));
check('Missing link opens Offline; stubbed LAADS listing stored', tabNow === 'Offline' && stubbed >= 1 && listed === LISTED.join(' ') && chips.includes('h18v03:viirs-missing') && chips.includes('h17v04:viirs-ocean'), `tab ${tabNow}, ${stubbed} stubbed, chips ${chips}`);

// 3. Import the synthetic tiles through the Offline file input.
const files = readdirSync(tiles)
  .filter((f) => f.endsWith('.h5'))
  .map((f) => join(tiles, f));
const input = (await tab.send('Runtime.evaluate', { expression: `document.querySelector('input[aria-label="Import VNP46A4 tiles"]')` })) as { result: { objectId?: string } };
if (input.result.objectId) await tab.send('DOM.setFileInputFiles', { files, objectId: input.result.objectId });
const imported = await tab.until<string>(`(() => { const t = window.__scape.offline.getState().viirs.tiles; return t.length >= ${files.length} ? t.map((x) => x.year + '/' + x.tile).join(' ') : ''; })()`, 120_000);
const importErr = await ev<string>(`document.querySelector('p.error')?.textContent ?? ''`);
await tab.shot(join(shots, 'desktop-offline-imported.png'));
check('Offline: synthetic 2400² tiles import', !!imported && !importErr && (await ev<boolean>(`!!document.querySelector('[data-viirs="imported"]')`)), `${imported ?? 'none'} ${importErr}`);

// 4. Each site, camera and target, on both viewports.
const mags: Record<string, number> = {};
for (const v of views) {
  await tab.viewport(v.w, v.h);
  for (const s of Object.keys(SITES) as Site[]) {
    await go(url(s));
    const ready = await settle('Ready');
    await openNight();
    await steady();
    const cam = await readPoint('Camera');
    const tgt = await readPoint('Target');
    const extra = await ev<{ toward: string; worst: number; chart: boolean; badge: string; badgeTitle: string }>(`(() => ({
      toward: document.querySelector('.sky-toward')?.textContent.trim() ?? '',
      worst: Number(document.querySelector('.sky-moon')?.dataset.worst ?? 'NaN'),
      chart: !!document.querySelector('.moon-chart svg polyline'),
      badge: document.querySelector('.sky-badge')?.textContent.trim() ?? '',
      badgeTitle: document.querySelector('.sky-badge')?.title ?? ''
    }))()`);
    await tab.shot(join(shots, `${v.name}-${s}.png`));
    const fits = await noSideways();
    const pointOk = (p: Point | null) => !!p && READOUT.test(p.text) && p.title === TOOLTIP && DARKHOURS.test(p.href) && p.target === '_blank' && /noopener/.test(p.rel) && /noreferrer/.test(p.rel);
    const bortle = cam?.text.match(/Bortle ≈ ([\d–]+)/)?.[1] ?? '?';
    mags[`${v.name}-${s}`] = Number(cam?.text.match(/Sky ≈ ([\d.]+)/)?.[1] ?? NaN);
    check(`${v.name} ${s}: camera and target readouts, DarkHours links`, ready && pointOk(cam) && pointOk(tgt), `${cam?.text.split(' · More')[0]} / target ${tgt?.text.split(' · ')[0]} · ${cam?.href}`);
    check(`${v.name} ${s}: toward-aim glow, moonlight, badge, no sideways scroll`, /toward \d+° [NESW]+/.test(extra.toward) && extra.worst < -0.1 && extra.chart && extra.badge.endsWith(`Bortle ≈ ${bortle}`) && extra.badgeTitle.includes(TOOLTIP) && fits, `${extra.toward}; moon ${extra.worst} mag, chart ${extra.chart}; badge "${extra.badge}"; fits ${fits}${cam?.domes ? `; ${cam.domes.replace(/^· /, '')}` : ''}`);
  }
}
await tab.viewport(1400, 900);
const order = mags['desktop-rotterdam'] < mags['desktop-rural'] && mags['desktop-rural'] < mags['desktop-zselic'] && ['rotterdam', 'rural', 'zselic'].every((s) => mags[`desktop-${s}`] === mags[`phone-${s}`]);
check('Sites order city < rural < Zselic, same on both viewports', order, Object.entries(mags).map(([k, m]) => `${k} ${m}`).join(', '));
const zselicDome = (await readPoint('Camera'))?.domes ?? '';
check('Zselic: dome toward the synthetic town', /dome \d+° N[NEW]*, ~[\d.]+° high/.test(zselicDome), zselicDome || 'none');

// 5. One GPU run per pin move, one per burst, none while still.
const runs = () => ev<number>('window.__scape.skyglow.getState().runs');
let r0 = await runs();
await ev(pin({ lat: 46.24, lng: 17.76 }));
await Bun.sleep(1500);
const single = (await runs()) - r0;
r0 = await runs();
for (let i = 1; i <= 5; i++) {
  await ev(pin({ lat: 46.24 + i * 0.003, lng: 17.76 }));
  await Bun.sleep(40);
}
await Bun.sleep(1500);
const burst = (await runs()) - r0;
check('One update per pin move; a burst of 5 moves runs once', single === 1 && burst === 1, `move ${single} run, burst ${burst} run`);

// 6. Still: no frames, no GPU work, once terrain and map loads from the moves have drained.
for (const t0 = Date.now(); Date.now() - t0 < 30_000; ) {
  await ev('window.__scape.idle.reset()');
  await Bun.sleep(1000);
  if ((await ev<number>('window.__scape.idle.glDraws')) === 0) break;
}
await ev('window.__scape.idle.reset()');
r0 = await runs();
await Bun.sleep(3000);
const idle = await ev<{ raf: number; glFrames: number; glDraws: number }>('(({ raf, glFrames, glDraws }) => ({ raf, glFrames, glDraws }))(window.__scape.idle)');
const idleRuns = (await runs()) - r0;
check('Idle 3 s: 0 rAF, 0 GL draws, 0 sky runs', idle.raf === 0 && idle.glDraws === 0 && idleRuns === 0, `rAF ${idle.raf}, GL frames ${idle.glFrames}, GL draws ${idle.glDraws}, runs ${idleRuns}`);

// 7. GPU timing and accuracy, under the shared lock.
const timing = await withLock(async () => {
  await ev(pin(SITES.rotterdam.camera));
  await tab.until(`window.__scape.skyglow.getState().runs > ${await runs()}`, 30_000, 100);
  await Bun.sleep(700);
  const far = await ev<number>('window.__scape.skyglow.getState().lastMs');
  const r = await runs();
  await ev(pin({ lat: 51.93, lng: 4.5 }));
  await tab.until(`window.__scape.skyglow.getState().runs > ${r}`, 30_000, 100);
  await Bun.sleep(700);
  const near = await ev<number>('window.__scape.skyglow.getState().lastMs');
  const cmp = await ev<{ gpu: number; ref: number; rel: number } | null>('window.__scape.skyglow.getState().compareReference()');
  return { far, near, cmp };
});
check('GPU total matches the CPU reference', !!timing.cmp && Math.abs(timing.cmp.rel) < 0.02, `rel ${timing.cmp?.rel.toExponential(2)}; new window ${timing.far.toFixed(0)} ms, reused pyramid ${timing.near.toFixed(0)} ms`);

// 8. One live LAADS listing, unstubbed: keyless and CORS-open.
await tab.send('Fetch.disable');
const live = await ev<string>(`fetch('https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VNP46A4/${YEAR}/001.json').then(async (r) => { const j = await r.json(); return r.status + ' ' + (j.content?.length ?? 0) + ' ' + j.content?.some((c) => c.name.includes('.h18v03.')); }).catch((e) => 'error ' + e.message)`);
check(`Live LAADS ${YEAR} listing from the page (CORS, no key)`, /^200 \d{3,} true$/.test(live), `status, files, has h18v03: ${live}`);

await ev('window.__scape.offline.getState().removeViirs()');
console.log('| Check | Result | Detail |');
console.log('|---|---|---|');
console.log(rows.join('\n'));
tab.close();
process.exit(failed ? 1 : 0);
