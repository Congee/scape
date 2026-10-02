// Weather smoke: Open-Meteo stubbed through CDP Fetch (plus one live request), desktop and phone.
// Usage: bun scripts/smoke/weather.ts <cdp> <dev-port> <screenshot-dir> [brave-profile gpu-timing-lock-dir]
// With a profile and lock it also measures idle renderer CPU with the map layer on, holding the lock per measurement.
/* oxlint-disable no-await-in-loop -- checks run one at a time against one page */
import { mkdirSync, rmdirSync } from 'node:fs';
import { FOG_TEXT, FOG_VISIBILITY_M, MIST_VISIBILITY_M } from '../../src/lib/core/weather/fog';
import { windyUrl } from '../../src/lib/core/weather/windy';
import { Tab } from './cdp';
import { OpenMeteoStub, StubMode } from './weather-stub';

const [cdp, port, out, profile, lock] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const CAMERA = { lat: 51.9225, lng: 4.4792 };
const TARGET = { lat: 51.95, lng: 4.55 };
const DAY = '2026-09-26T17:00Z';
const FAR_DAY = '2026-10-20T12:00Z';
const DENVER = { lat: 39.7392, lng: -104.9903 };
const PARIS = { lat: 48.8566, lng: 2.3522 };
const LAYERS = ['Total', 'Low', 'Mid', 'High', 'Fog'] as const;
// Open-Meteo's free tier is 600 weighted calls a minute; a whole run should stay far under.
const MAX_REQUESTS = 40;
const IDLE_S = 20;
const CPU_MAX = 2;
mkdirSync(out, { recursive: true });

const rows: string[] = [];
let fails = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) fails++;
  console.error(ok ? "PASS" : "FAIL", name, detail);
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail.replace(/\|/g, '/').replace(/\s+/g, ' ')} |`);
};

const tab = await Tab.open(Number(cdp), BASE);
const stub = new OpenMeteoStub(tab);
await stub.install();
const js = <T = string>(e: string) => tab.eval<T>(e);
const text = (sel: string) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
const until = (e: string, ms = 20_000) => tab.until(e, ms, 250);
const tabTo = (t: string) => js(`(() => { const u = window.__scape.ui.getState(); u.setPanelTab('${t}'); u.setPanelCollapsed(false); return 1; })()`);
const setPin = (p: { lat: number; lng: number }) => js(`(() => { window.__scape.world.getState().setPin({ lat: ${p.lat}, lng: ${p.lng} }); return 1; })()`);
const cardReady = (card: string) => until(`(() => { const c = document.querySelector('[data-card="${card}"]'); return c && !/Loading forecast/.test(c.textContent) && c.textContent; })()`);
const cloudText = () => text('[data-card="camera"] [data-v="cloud"]');

async function fresh(url: string) {
  // Boot at the test pins, not the last run's, and fail their fetch so the cache stays empty.
  const mode = stub.mode;
  stub.mode = StubMode.Fail;
  await tab.navigate(url);
  // Clears rather than deletes: a delete waits on every open connection, other tabs included.
  await js(`new Promise((r) => { window.__scape?.settings.getState().update({ weather: true }); localStorage.removeItem('scape.weatherBudget'); localStorage.removeItem('scape.weather'); const q = indexedDB.open('scape-weather'); q.onupgradeneeded = () => q.transaction.abort(); q.onerror = () => r(1); q.onsuccess = () => { const db = q.result, names = [...db.objectStoreNames]; if (!names.length) return (db.close(), r(1)); const t = db.transaction(names, 'readwrite'); for (const n of names) t.objectStore(n).clear(); t.oncomplete = t.onerror = () => (db.close(), r(1)); }; })`);
  stub.mode = mode;
  await tab.navigate(url);
  await until('window.__scape && window.__scapeMap && document.querySelector(".tabs button")', 30_000);
  await tabTo('Weather');
}

/** Fewest rAF callbacks over up to three 3 s windows, so late tile loads do not count. */
async function quietRaf() {
  let best = Infinity;
  for (let i = 0; i < 3 && best > 0; i++) {
    await js('(() => { window.__scape.idle.reset(); return 1; })()');
    await Bun.sleep(3000);
    best = Math.min(best, await js<number>('window.__scape.idle.raf'));
  }
  return best;
}

async function cpuSecs() {
  const ps = await new Response(Bun.spawn(['ps', '-axo', 'pid=,time=,command='], { stdout: 'pipe' }).stdout).text();
  const r = new Map<string, number>();
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s/.exec(line);
    if (m && line.includes(`--user-data-dir=${profile}`) && line.includes('--type=renderer') && !line.includes('--extension-process')) r.set(m[1], m[2].split(':').reduce((a, p) => a * 60 + Number(p), 0));
  }
  return r;
}

async function idleCpu() {
  while (true) {
    try {
      mkdirSync(lock!);
      break;
    } catch {
      await Bun.sleep(30_000);
    }
  }
  try {
    const a = await cpuSecs();
    const t0 = performance.now();
    await Bun.sleep(IDLE_S * 1000);
    const b = await cpuSecs();
    const dt = (performance.now() - t0) / 1000;
    return +((100 * Math.max(0, ...[...b].map(([pid, s]) => s - (a.get(pid) ?? s)))) / dt).toFixed(1);
  } finally {
    rmdirSync(lock!);
  }
}

async function run(vp: 'desktop' | 'phone') {
  await tab.send('Emulation.setDeviceMetricsOverride', vp === 'phone' ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } : { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
  stub.mode = StubMode.Fixture;
  const since = Date.now();
  const url = `${BASE}/?camera=${CAMERA.lat},${CAMERA.lng}&target=${TARGET.lat},${TARGET.lng}&t=${DAY}`;
  await fresh(url);

  // Now card, credit, model line, Windy links.
  await cardReady('camera');
  const card = await text('[data-card="camera"]');
  const model = await text('.wx-model');
  const credit = await js(`document.querySelector('.weather .wx-credit a')?.href ?? ''`);
  check(`${vp}: now card with model, grid, age and credit`, /\d+%/.test(await cloudText()) && /fetched \d+ min ago/.test(card) && /Grid /.test(model) && credit.startsWith('https://open-meteo.com'), `${await cloudText()} · ${model.slice(0, 60)}`);
  await cardReady('target');
  const links = await js<{ href: string; target: string; rel: string }[]>(`[...document.querySelectorAll('[data-card="camera"] .wx-windy, [data-card="target"] .wx-windy')].map((a) => ({ href: a.href, target: a.target, rel: a.rel }))`);
  const want = [windyUrl(CAMERA.lat, CAMERA.lng), windyUrl(TARGET.lat, TARGET.lng)];
  check(`${vp}: Windy links for camera and target (not followed)`, links.length === 2 && links.every((l, i) => l.href === want[i] && l.target === '_blank' && l.rel === 'noopener noreferrer'), links.map((l) => l.href).join(' , '));
  await tab.shot(`${out}/${vp}-now.png`);

  // The fixture's pre-dawn hours carry fog code and 600 m visibility, then 3 km mist until 08Z.
  await fresh(url.replace(DAY, DAY.replace('T17', 'T03')));
  await cardReady('camera');
  const fog = await text('[data-card="camera"] [data-v="fog"]');
  check(`${vp}: 03Z fog row reads Fog with its signs`, fog === `Fog possible: ${FOG_TEXT.Code}, ${FOG_TEXT.FogVisibility}`, fog);
  await tab.shot(`${out}/${vp}-fog.png`);
  await js(`(() => { window.__scape.world.getState().setTime(Date.parse('2026-09-26T06:30Z')); return 1; })()`);
  await until(`document.querySelector('[data-card="camera"] [data-v="fog"]')?.dataset.fog === 'Mist'`, 5000);
  const mist = await text('[data-card="camera"] [data-v="fog"]');
  check(`${vp}: 06:30Z fog row reads Mist`, mist === `Mist possible: ${FOG_TEXT.MistVisibility}`, mist);
  await tab.shot(`${out}/${vp}-mist.png`);
  await js(`(() => { window.__scape.world.getState().setTime(Date.parse('2026-09-26T09:00Z')); return 1; })()`);
  await until(`document.querySelector('[data-card="camera"] [data-v="fog"]')?.dataset.fog === 'None'`, 5000);
  check(`${vp}: 09Z fog row reads no signs`, (await text('[data-card="camera"] [data-v="fog"]')) === 'no signs', await text('[data-card="camera"] [data-v="fog"]'));
  await fresh(url);
  await cardReady('camera');

  // Model switch through the picker.
  const before = await cloudText();
  const n0 = stub.forecasts(since).length;
  await js(`(() => { const s = document.querySelector('select[aria-label="Forecast model"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'ecmwf_ifs025'); s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  await until(`!/Loading/.test(document.querySelector('[data-card="camera"]').textContent) && /Grid 25 km/.test(document.querySelector('.wx-model')?.textContent ?? '')`);
  await until(`document.querySelector('[data-card="camera"] [data-v="cloud"]')?.textContent !== ${JSON.stringify(before)}`, 10_000);
  const after = await cloudText();
  const asked = stub.forecasts(since).slice(n0).some((h) => h.model === 'ecmwf_ifs025');
  check(`${vp}: model switch refetches and changes the card`, asked && after !== before && after !== '', `${before} → ${after} · ${(await text('.wx-model')).slice(0, 50)}`);
  await tab.shot(`${out}/${vp}-model.png`);

  // Timeline row follows the clock.
  if (!(await js<boolean>('!!document.querySelector(".cloud-row .extra")'))) await tabTo('Weather');
  await until('document.querySelector(".cloud-row .cloud-chart")');
  const r0 = await text('.cloud-row .extra');
  const x0 = await js(`document.querySelector('.cloud-row line.now')?.getAttribute('x1') ?? ''`);
  await js(`(() => { window.__scape.world.getState().setTime(Date.parse('2026-09-26T03:30Z')); return 1; })()`);
  await until(`document.querySelector('.cloud-row .extra')?.textContent !== ${JSON.stringify(r0)}`, 5000);
  const r1 = await text('.cloud-row .extra');
  const x1 = await js(`document.querySelector('.cloud-row line.now')?.getAttribute('x1') ?? ''`);
  check(`${vp}: Timeline cloud row follows scrubbing`, r1 !== r0 && x1 !== x0 && /low \d+%/.test(r1), `${r0} → ${r1}`);
  // ECMWF serves no visibility, so mist needs best_match.
  await js(`(() => { window.__scape.weather.getState().setModel('best_match'); return 1; })()`);
  await until(`/mist signs/.test(document.querySelector('.cloud-row .extra')?.textContent ?? '')`, 10_000);
  const r2 = await text('.cloud-row .extra');
  const bars = await js<{ fog: number; mist: number }>(`({ fog: document.querySelectorAll('.cloud-row .cloud-chart rect.fog').length, mist: document.querySelectorAll('.cloud-row .cloud-chart rect.mist').length })`);
  check(`${vp}: Timeline row spans fog then mist`, /fog signs .+–.+ · mist signs .+–.+ · Best match/.test(r2) && bars.fog === 6 && bars.mist === 2, `${r2} · bars fog ${bars.fog} mist ${bars.mist}`);
  await tab.shot(`${out}/${vp}-timeline.png`);
  await js(`(() => { window.__scape.world.getState().setTime(Date.parse('${DAY}')); return 1; })()`);
  await tabTo('Weather');

  // Sunset sightline over the fixture's westward low cloud.
  await js(`(() => { const w = window.__scape.weather.getState(); w.setModel('best_match'); return 1; })()`);
  await Bun.sleep(500);
  const sunset = (await until<string>(`(() => { const d = document.querySelector('[data-card="sightlines"] details[data-event="sun-set"]'); return d && window.__scape.weather.getState().model === 'best_match' && !/Loading/.test(d.closest('section').textContent) ? d.dataset.verdict + ' · ' + d.querySelector('summary').textContent : ''; })()`, 30_000)) ?? 'missing';
  check(`${vp}: Rotterdam sunset sightline reads blocked`, sunset.startsWith('Blocked'), sunset);
  await js(`document.querySelector('[data-card="sightlines"]').scrollIntoView()`);
  await tab.shot(`${out}/${vp}-sightlines.png`);

  // Map layer per variable, at a regional zoom so a pan crosses lattice cells.
  await js(`(() => { window.__scapeMap.jumpTo({ center: [${CAMERA.lng}, ${CAMERA.lat}], zoom: 7 }); return 1; })()`);
  for (const layer of LAYERS) {
    const p0 = await js<number>('window.__scape.cloudStats.paints');
    await js(`(() => { window.__scape.weather.getState().setLayer('${layer}'); return 1; })()`);
    const painted = await until(`window.__scape.cloudStats.paints > ${p0} && window.__scape.weather.getState().cloudInfo`);
    // The phone legend starts folded; open it as a user would.
    await js(`(() => { document.querySelector('button.cloud-legend.folded')?.click(); return 1; })()`);
    await until(`document.querySelector('.cloud-legend[data-layer="${layer}"] [data-info]')`, 5000);
    const legend = await text(`.cloud-legend[data-layer="${layer}"]`);
    const vis = await js(`window.__scapeMap.getLayoutProperty('weather-cloud', 'visibility')`);
    check(`${vp}: map layer ${layer}`, !!painted && vis === 'visible' && /km cells/.test(legend) && /Open-Meteo/.test(legend), legend);
    await Bun.sleep(500);
    await tab.shot(`${out}/${vp}-layer-${layer.toLowerCase()}.png`);
  }
  const fogLegend = await text('.cloud-legend[data-layer="Fog"] .scale');
  check(`${vp}: Fog layer legend names mist and fog`, fogLegend.includes(`Mist ${FOG_VISIBILITY_M / 1000}–${MIST_VISIBILITY_M / 1000} km`) && fogLegend.includes(`Fog < ${FOG_VISIBILITY_M / 1000} km`), fogLegend);
  for (const [at, name] of [['03:00', 'fog'], ['06:30', 'mist']] as const) {
    const p0 = await js<number>('window.__scape.cloudStats.paints');
    await js(`(() => { window.__scape.world.getState().setTime(Date.parse('2026-09-26T${at}Z')); return 1; })()`);
    await until(`window.__scape.cloudStats.paints > ${p0}`);
    await Bun.sleep(500);
    await tab.shot(`${out}/${vp}-layer-fog-${name}.png`);
  }
  await js(`(() => { window.__scape.world.getState().setTime(Date.parse('${DAY}')); return 1; })()`);
  // ecmwf_ifs025 reports no visibility: the fog layer is all gap, hatched.
  await js(`(() => { window.__scape.weather.getState().setModel('ecmwf_ifs025'); return 1; })()`);
  await until(`window.__scape.weather.getState().cloudInfo?.at > ${Date.now()}`);
  await Bun.sleep(500);
  await tab.shot(`${out}/${vp}-layer-fog-gaps.png`);
  await js(`(() => { window.__scape.weather.getState().setModel('best_match'); window.__scape.weather.getState().setLayer('Low'); return 1; })()`);
  await until(`window.__scape.weather.getState().cloudInfo?.at > ${Date.now()}`);

  const mapLink = await js<{ href: string; want: string }>(`(() => { const m = window.__scapeMap, c = m.getCenter(); return { href: document.querySelector('[data-card="map-layer"] .wx-windy')?.href ?? '', want: [c.lat, c.lng, m.getZoom()].join(',') }; })()`);
  const [la, lo, z] = mapLink.want.split(',').map(Number);
  check(`${vp}: map-layer Windy link at centre and zoom`, mapLink.href === windyUrl(la, lo, z + 1), mapLink.href);

  // Pan refetches only after the map settles.
  const f0 = await js<number>('window.__scape.cloudStats.fetches');
  const h0 = stub.forecasts(since).length;
  for (let i = 1; i <= 5; i++) {
    await js(`(() => { const m = window.__scapeMap, c = m.getCenter(); m.jumpTo({ center: [c.lng - 0.12, c.lat] }); return 1; })()`);
    await Bun.sleep(100);
  }
  await Bun.sleep(200);
  const mid = await js<number>('window.__scape.cloudStats.fetches');
  await Bun.sleep(1500);
  const f1 = await js<number>('window.__scape.cloudStats.fetches');
  const h1 = stub.forecasts(since).length - h0;
  check(`${vp}: pan refetches once, only after settle`, mid === f0 && f1 === f0 + 1 && h1 <= 1, `fetches ${f0} → ${mid} while panning → ${f1} settled; ${h1} request`);

  // Idle with the layer on.
  await Bun.sleep(1000);
  const raf = await quietRaf();
  check(`${vp}: idle 3 s with the layer on: 0 rAF`, raf === 0, `rAF ${raf}`);
  if (vp === 'desktop' && profile && lock) {
    const cpu = await idleCpu();
    check(`${vp}: idle renderer CPU with the layer on`, cpu <= CPU_MAX, `${cpu}% of a core over ${IDLE_S} s (≤ ${CPU_MAX}%)`);
  }
  await js(`(() => { window.__scape.weather.getState().setLayer('Off'); return 1; })()`);

  // Out of Open-Meteo's range.
  await js(`(() => { window.__scape.world.getState().setTime(Date.parse('${FAR_DAY}')); return 1; })()`);
  await until(`/no forecast for this date|outside/i.test(document.querySelector('[data-card="camera"]')?.textContent ?? '')`);
  const far = await text('[data-card="camera"] .wx-missing');
  check(`${vp}: out-of-horizon date says so, no values`, /no forecast for this date|outside/i.test(far) && !(await js<boolean>('!!document.querySelector(\'[data-card="camera"] [data-v="cloud"]\')')), far);
  await tab.shot(`${out}/${vp}-far.png`);
  await js(`(() => { window.__scape.world.getState().setTime(Date.parse('${DAY}')); return 1; })()`);

  // Offline: a cached point still shows, an uncached one says so.
  await setPin(PARIS);
  await cardReady('camera');
  await tab.setOffline(true);
  const o0 = stub.forecasts(since).length;
  await setPin(CAMERA);
  await cardReady('camera');
  const cached = await cloudText();
  check(`${vp}: offline with cache shows the cached forecast`, /\d+%/.test(cached) && stub.forecasts(since).length === o0, `${cached} · ${(await text('[data-card="camera"] h3')).trim()}`);
  await setPin(DENVER);
  await until(`/Offline/.test(document.querySelector('[data-card="camera"]')?.textContent ?? '')`);
  const none = await text('[data-card="camera"] .wx-missing');
  check(`${vp}: offline without cache says so`, /Offline/.test(none) && !(await js<boolean>('!!document.querySelector(\'[data-card="camera"] [data-v="cloud"]\')')), none || (await text('[data-card="camera"]')).slice(0, 120));
  await tab.shot(`${out}/${vp}-offline.png`);
  await tab.setOffline(false);

  const wide = await js<boolean>('document.documentElement.scrollWidth > window.innerWidth');
  check(`${vp}: no sideways page scroll`, !wide, `overflow ${wide}`);
  const hits = stub.forecasts(since);
  const stats = await js<{ refused: number; errors: number; weight: number }>('window.__scape.weatherStats');
  check(`${vp}: requests within budget`, hits.length <= MAX_REQUESTS && stats.refused === 0 && stats.weight < 600, `${hits.length} forecast requests, ${hits.reduce((a, h) => a + h.locations, 0)} points, weight ${stats.weight.toFixed(1)}, refused ${stats.refused}`);

  // Privacy off: no location leaves, every forecast says why.
  await js(`(() => { window.__scape.weather.getState().setLayer('Low'); return 1; })()`);
  await until(`window.__scape.weather.getState().cloudInfo?.at > ${Date.now()}`);
  await js(`(() => { window.__scape.settings.getState().update({ weather: false }); return 1; })()`);
  const p0 = stub.hits.length;
  const pf0 = await js<number>('window.__scape.cloudStats.fetches');
  await setPin(PARIS);
  await js(`(() => { const m = window.__scapeMap, c = m.getCenter(); m.jumpTo({ center: [c.lng + 1, c.lat] }); return 1; })()`);
  await tabTo('Weather');
  await until('document.querySelector(\'[data-wx="off"]\')', 5000);
  const offWx = await text('[data-wx="off"]');
  if (!(await js<boolean>('!!document.querySelector(".cloud-row")'))) await tabTo('Weather');
  await until('document.querySelector(".cloud-row[data-off]")', 5000);
  const offRow = await text('.cloud-row .extra');
  await Bun.sleep(1500);
  const pf1 = await js<number>('window.__scape.cloudStats.fetches');
  const vis = await js(`window.__scapeMap.getLayoutProperty('weather-cloud', 'visibility')`);
  check(`${vp}: privacy off sends nothing, rows say so`, /off for privacy/i.test(offWx) && offRow === 'off for privacy' && stub.hits.length === p0 && pf1 === pf0 && vis === 'none', `${offRow} · ${offWx.slice(0, 40)} · ${stub.hits.length - p0} requests, ${pf1 - pf0} layer fetches, layer ${vis}`);
  await tab.shot(`${out}/${vp}-privacy.png`);
  await tab.navigate(`${BASE}/settings`);
  await until('document.querySelector(\'[aria-label="Fetch weather forecasts"]\')', 30_000);
  const box = await js<boolean>('document.querySelector(\'[aria-label="Fetch weather forecasts"]\').getAttribute("aria-pressed") === "true"');
  await js('document.querySelector(\'[aria-label="Fetch weather forecasts"]\').click()');
  const back = await until('window.__scape.settings.getState().weather === true', 5000);
  check(`${vp}: Settings toggle persists and turns forecasts back on`, !box && !!back, `checked ${box} → store ${back}`);
  await js(`(() => { window.__scape.weather.getState().setLayer('Off'); return 1; })()`);
}

await run('desktop');
await run('phone');

// One real request, so the stub's shape is checked against Open-Meteo.
await tab.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
stub.mode = StubMode.Live;
stub.liveLeft = 1;
const since = Date.now();
await fresh(`${BASE}/?camera=${CAMERA.lat},${CAMERA.lng}&t=${new Date(Date.now() + 3_600_000).toISOString().slice(0, 13)}:00Z`);
await tab.eval(`(() => { window.__scape.world.getState().setPin2(null); return 1; })()`).catch(() => 0);
await cardReady('camera');
const live = stub.forecasts(since).filter((h) => h.live);
check('desktop: one live Open-Meteo request parses', live.length === 1 && (await js<number>('window.__scape.weatherStats.errors')) === 0 && /\d+%/.test(await cloudText()), `${live.length} live · ${await cloudText()}`);
await tab.shot(`${out}/desktop-live.png`);
stub.mode = StubMode.Fixture;

await tab.send('Emulation.clearDeviceMetricsOverride');
await tab.send('Fetch.disable');
tab.close();
console.log('| Check | Result | Detail |');
console.log('|---|---|---|');
console.log(rows.join('\n'));
console.log(`Screenshots: ${out}`);
process.exit(fails ? 1 : 0);
