// Alpenglow smoke: Weather › Alpenglow for the target, else the camera pin, Open-Meteo stubbed through CDP Fetch (plus one live request), desktop and phone.
// Usage: bun scripts/smoke/alpenglow.ts <cdp> <dev-port> <screenshot-dir>
/* oxlint-disable no-await-in-loop -- checks run one at a time against one page */
import { mkdirSync } from 'node:fs';
import type { HourlyVar } from '../../src/lib/core/weather/openMeteo';
import { Tab } from './cdp';
import { OpenMeteoStub, StubMode, type Hit } from './weather-stub';

const [cdp, port, out] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const POINT = { lat: 51.9225, lng: 4.4792 };
// Jungfrau's south-east ridge, near 3500 m: above the low band.
const SUMMIT = { lat: 46.5475, lng: 7.9625 };
// Mönch, the target moved.
const SUMMIT2 = { lat: 46.5585, lng: 7.9975 };
const MAX_REQUESTS = 20;
mkdirSync(out, { recursive: true });

const rows: string[] = [];
let fails = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) fails++;
  console.error(ok ? 'PASS' : 'FAIL', name, detail);
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail.replace(/\|/g, '/').replace(/\s+/g, ' ')} |`);
};

/** Low cloud only west of the point, some high cloud, no fog: sunrise clear, sunset blocked. */
function westLow(v: HourlyVar, _h: number, _lat: number, lng: number): number | null {
  switch (v) {
    case 'cloud_cover_low':
      return lng < POINT.lng - 0.1 ? 90 : 0;
    case 'cloud_cover_high':
      return 40;
    case 'visibility':
      return 24_000;
    case 'weather_code':
      return 2;
  }
  return 0;
}
/** Low cloud everywhere under clear mid and high sky. */
const lowSea = (v: HourlyVar): number | null => (v === 'cloud_cover_low' ? 80 : v === 'cloud_cover_high' ? 40 : v === 'visibility' ? 24_000 : v === 'weather_code' ? 3 : 0);
const foggy = (v: HourlyVar, h: number, lat: number, lng: number) => (v === 'weather_code' ? 45 : v === 'visibility' ? 300 : westLow(v, h, lat, lng));

const tab = await Tab.open(Number(cdp), BASE);
const stub = new OpenMeteoStub(tab);
await stub.install();
const js = <T = string>(e: string) => tab.eval<T>(e);
const text = (sel: string) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
const until = <T = unknown>(e: string, ms = 20_000) => tab.until<T>(e, ms, 250);
const row = (kind: string, day = 1) => `.glow-list li[data-glow-event="${kind}"][data-day="${day}"]`;
// The Weather tab's own cards ask for one day; the alpenglow request spans the week.
const spansDays = (h: Hit) => {
  const u = new URL(h.url);
  return (Date.parse(u.searchParams.get('end_date') ?? '') - Date.parse(u.searchParams.get('start_date') ?? '')) / 86_400_000;
};
const glowHits = (since: number) => stub.forecasts(since).filter((h) => spansDays(h) >= 3);
// First location of a request, rounded as sent.
const firstAt = (h: Hit) => {
  const u = new URL(h.url).searchParams;
  return `${Number(u.get('latitude')?.split(',')[0]).toFixed(2)},${Number(u.get('longitude')?.split(',')[0]).toFixed(2)}`;
};
const sent = (p: { lat: number; lng: number }) => `${(Math.round(p.lat * 100) / 100).toFixed(2)},${(Math.round(p.lng * 100) / 100).toFixed(2)}`;
const glowAt = () => js<{ at: string; label: string }>(`(() => { const d = document.querySelector('details[data-card=alpenglow]'); return { at: d?.dataset.glowAt ?? '', label: d?.querySelector('summary')?.textContent ?? '' }; })()`);
const stats = () => js<{ fetches: number; cacheHits: number }>('({ ...window.__scape.glowStats })');

/** Loads the app with the camera at `at`, the Weather tab open, and the pin's skyline swept. */
async function atPin(at = POINT) {
  await tab.navigate(`${BASE}/`);
  await until('window.__scape && document.querySelector(".tabs button")', 30_000);
  await js(`(() => { const s = window.__scape; s.world.getState().setPin(${JSON.stringify(at)}); s.world.getState().setPin2(null); const u = s.ui.getState(); u.setPanelTab('Weather'); u.setPanelCollapsed(false); return 1; })()`);
  await until(`(() => { const t = window.__scape.terrain.getState(); return t.horizon?.refined && t.horizonKey.startsWith('${at.lat.toFixed(4)},${at.lng.toFixed(4)}|'); })()`, 120_000);
  await until('document.querySelector("details[data-card=alpenglow] > summary[data-glow-toggle]")');
}

async function fresh(at = POINT) {
  const mode = stub.mode;
  stub.mode = StubMode.Fail;
  await tab.navigate(`${BASE}/`);
  await js(`new Promise((r) => { window.__scape?.settings.getState().update({ weather: true }); localStorage.removeItem('scape.weatherBudget'); localStorage.removeItem('scape.weather'); const q = indexedDB.open('scape-weather'); q.onupgradeneeded = () => q.transaction.abort(); q.onerror = () => r(1); q.onsuccess = () => { const db = q.result, names = [...db.objectStoreNames]; if (!names.length) return (db.close(), r(1)); const t = db.transaction(names, 'readwrite'); for (const n of names) t.objectStore(n).clear(); t.oncomplete = t.onerror = () => (db.close(), r(1)); }; })`);
  stub.mode = mode;
  await atPin(at);
}

/** Opens the forecast (closing it first if open) and waits for its answer. */
async function open() {
  const sel = 'details[data-card=alpenglow]';
  await js(`(() => { const d = document.querySelector('${sel}'); if (d.open) d.querySelector('summary').click(); return 1; })()`);
  await until(`!document.querySelector('${sel}').open && !document.querySelector('${sel} [data-glow]')`, 5000);
  await js(`(() => { document.querySelector('${sel} summary').click(); return 1; })()`);
  const st = await until<string>(`(() => { const g = document.querySelector('[data-glow]'); return g && g.dataset.glow !== 'loading' ? g.dataset.glow : ''; })()`, 30_000);
  await js('document.querySelector(".glow, [data-glow]")?.scrollIntoView()');
  return st ?? 'timeout';
}

/** Ages every stored copy past the model's run, after a reload empties the memory cache. */
async function ageCache(hours: number) {
  await tab.navigate(`${BASE}/`);
  await js(`new Promise((r) => { const q = indexedDB.open('scape-weather'); q.onsuccess = () => { const db = q.result, t = db.transaction('glow', 'readwrite'), s = t.objectStore('glow'); s.getAll().onsuccess = (e) => { for (const v of e.target.result) s.put({ ...v, fetchedAt: Date.now() - ${hours} * 3600000 }); }; t.oncomplete = () => (db.close(), r(1)); }; })`);
  await atPin();
}

async function run(vp: 'desktop' | 'phone') {
  await tab.send('Emulation.setDeviceMetricsOverride', vp === 'phone' ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } : { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
  stub.mode = StubMode.Fixture;
  stub.value = westLow;
  stub.availableAt = null;
  await js(`(() => { window.__scape?.weather.getState().setModel('best_match'); return 1; })()`).catch(() => 0);
  await fresh();
  await js(`(() => { window.__scape.weather.getState().setModel('best_match'); return 1; })()`);

  // Nothing leaves before the forecast is opened.
  const since = Date.now();
  await Bun.sleep(1500);
  check(`${vp}: nothing fetched until opened`, glowHits(since).length === 0, `${glowHits(since).length} requests`);

  // Offline, nothing cached.
  await tab.setOffline(true);
  const off0 = await open();
  const offNote = await text('[data-glow-note]');
  check(`${vp}: offline without a copy says none is downloaded`, off0 === 'None' && /Offline/.test(offNote) && /no alpenglow forecast downloaded/.test(offNote) && glowHits(since).length === 0, `${off0} · ${offNote}`);
  await tab.shot(`${out}/${vp}-offline-none.png`);
  await tab.setOffline(false);

  // Fixture: sunrise clear under high cloud, sunset behind low cloud to the west.
  const s0 = await stats();
  const st = await open();
  const hits = glowHits(since);
  const rise = await js<{ score: string; why: string }>(`(() => { const r = document.querySelector('${row('sunrise')}'); return { score: r?.dataset.score ?? '', why: r?.querySelector('.glow-why')?.textContent ?? '' }; })()`);
  const set = await js<{ score: string; why: string }>(`(() => { const r = document.querySelector('${row('sunset')}'); return { score: r?.dataset.score ?? '', why: r?.querySelector('.glow-why')?.textContent ?? '' }; })()`);
  check(`${vp}: one request for point and paths`, st === 'Ok' && hits.length === 1 && hits[0].locations % 5 === 1 && hits[0].locations >= 11 && (await stats()).fetches === s0.fetches + 1, `${st} · ${hits.length} request, ${hits[0]?.locations} points`);
  check(`${vp}: sunrise clear with high cloud scores 100`, rise.score === '100' && rise.why === 'clear toward the Sun, high cloud 40% overhead', `${rise.score} · ${rise.why}`);
  check(`${vp}: sunset names low cloud toward the Sun`, set.score === '10' && /^low cloud 90% toward the Sun, 25 km$/.test(set.why), `${set.score} · ${set.why}`);
  const days = await js<number[]>(`[...new Set([...document.querySelectorAll('.glow-list li')].map((l) => +l.dataset.day))]`);
  const shaky = await js<boolean>(`[...document.querySelectorAll('.glow-list li')].every((l) => l.classList.contains('shaky') === (+l.dataset.day >= 3))`);
  const credit = await js(`document.querySelector('.glow .wx-credit a')?.href ?? ''`);
  const hint = await text('.glow .hint');
  check(`${vp}: a week of days (past windows dropped), shaky from day 3, caveat and CC BY credit`, days.length >= 6 && days.at(-1) === 6 && shaky && /2–3 days/.test(hint) && credit.startsWith('https://open-meteo.com') && /CC BY 4\.0/.test(await text('.glow .wx-credit')), `days ${days.join(',')} · ${credit}`);
  check(`${vp}: model line shows age`, /Best match · fetched .* ago/.test(await text('[data-glow-age]')), await text('[data-glow-age]'));
  const t0 = await js<number>(`(() => { document.querySelector('${row('sunset')} button.link').click(); return window.__scape.world.getState().time; })()`);
  await tab.shot(`${out}/${vp}-fixture.png`);
  check(`${vp}: time button jumps to the window`, t0 > Date.now(), new Date(t0).toISOString());

  // Reopen: same run, no second request.
  const s1 = await stats();
  const n1 = glowHits(since).length;
  const again = await open();
  const s2 = await stats();
  check(`${vp}: reopen reuses the cache`, again === 'Ok' && glowHits(since).length === n1 && s2.cacheHits === s1.cacheHits + 1 && s2.fetches === s1.fetches, `${again} · hits ${s1.cacheHits} → ${s2.cacheHits}, requests +${glowHits(since).length - n1}`);

  // Offline with a copy older than the hour: shown with its age.
  await ageCache(2);
  await tab.setOffline(true);
  const offC = await open();
  const cNote = await text('[data-glow-note]');
  check(`${vp}: offline shows the last copy with its age`, offC === 'Cached' && /Offline · showing the copy fetched 2 h ago/.test(cNote) && (await js<string>(`document.querySelector('${row('sunset')}')?.dataset.score ?? ''`)) === '10', `${offC} · ${cNote}`);
  await tab.shot(`${out}/${vp}-offline-cached.png`);
  await tab.setOffline(false);

  // Server error: loud, over the old copy.
  stub.mode = StubMode.Error;
  const bad = await open();
  const eNote = await js<{ cls: string; t: string }>(`(() => { const n = document.querySelector('[data-glow-note]'); return { cls: n?.className ?? '', t: n?.textContent ?? '' }; })()`);
  check(`${vp}: server error fails loudly over the copy`, bad === 'Cached' && eNote.cls === 'error' && /Alpenglow forecast failed: .+ · showing the copy fetched 2 h ago/.test(eNote.t), `${bad} · ${eNote.t}`);
  await tab.shot(`${out}/${vp}-error.png`);
  stub.mode = StubMode.Fixture;
  // Retry refetches.
  const r0 = glowHits(since).length;
  await js(`(() => { document.querySelector('[data-glow-note] button.link').click(); return 1; })()`);
  const retried = await until(`document.querySelector('[data-glow]')?.dataset.glow === 'Ok'`, 15_000);
  check(`${vp}: Retry refetches`, !!retried && glowHits(since).length === r0 + 1, `+${glowHits(since).length - r0} request`);

  // A model that reports its run: reused while no newer run is out.
  stub.availableAt = Date.now() - 3_600_000;
  await js(`(() => { window.__scape.weather.getState().setModel('ecmwf_ifs025'); return 1; })()`);
  const m0 = glowHits(since).length;
  const ec = await open();
  const ec2 = await open();
  check(`${vp}: ECMWF fetched once, then reused until its next run`, ec === 'Ok' && ec2 === 'Ok' && glowHits(since).length === m0 + 1, `+${glowHits(since).length - m0} requests`);
  await js(`(() => { window.__scape.weather.getState().setModel('best_match'); return 1; })()`);

  // Sea of clouds: low cloud under a summit above 2 km earns a badge, not a lower score.
  const plain = await js<number>(`document.querySelectorAll('[data-glow-sea]').length`);
  stub.value = lowSea;
  await fresh(SUMMIT);
  await js(`(() => { window.__scape.weather.getState().setModel('best_match'); return 1; })()`);
  await open();
  const sea = await js<{ n: number; score: string; why: string; ground: number }>(`(() => { const r = document.querySelector('[data-glow-sea]')?.closest('li'); return { n: document.querySelectorAll('[data-glow-sea]').length, score: r?.dataset.score ?? '', why: r?.querySelector('.glow-why')?.textContent ?? '', ground: window.__scape.terrain.getState().horizon.groundM }; })()`);
  check(`${vp}: sea of clouds badge on a summit, score unchanged`, plain === 0 && sea.ground > 2000 && sea.n > 0 && sea.score === '100' && sea.why.startsWith('sea of clouds'), `${Math.round(sea.ground)} m · ${sea.n} badges · ${sea.score} · ${sea.why} · lowland ${plain}`);
  await js('document.querySelector("[data-glow-sea]")?.scrollIntoView()');
  await tab.shot(`${out}/${vp}-sea.png`);

  // Target set: the forecast follows it, on its own skyline and cache key; cleared, it falls back to the pin.
  await fresh();
  await js(`(() => { window.__scape.weather.getState().setModel('best_match'); return 1; })()`);
  const pinLabel = await glowAt();
  await open();
  const pinSea = await js<number>(`document.querySelectorAll('[data-glow-sea]').length`);
  check(`${vp}: no target, section says the camera`, pinLabel.at === 'Pin' && /Alpenglow · at the camera/.test(pinLabel.label) && pinSea === 0, `${pinLabel.at} · ${pinLabel.label} · ${pinSea} badges`);
  await js(`(() => { document.querySelector('details[data-card=alpenglow] summary').click(); return 1; })()`);
  const g0 = glowHits(since).length;
  await js(`(() => { window.__scape.world.getState().setPin2(${JSON.stringify(SUMMIT)}); return 1; })()`);
  await Bun.sleep(1500);
  const closedHits = glowHits(since).length - g0;
  const tLabel = await glowAt();
  const tSt = await open();
  const tHits = glowHits(since).slice(g0);
  const tSea = await js<number>(`document.querySelectorAll('[data-glow-sea]').length`);
  check(`${vp}: target set, forecast follows it`, closedHits === 0 && tLabel.at === 'Target' && /Alpenglow · at the target/.test(tLabel.label) && tSt === 'Ok' && tHits.length === 1 && firstAt(tHits[0]) === sent(SUMMIT) && tSea > 0, `closed +${closedHits} · ${tLabel.label} · ${tSt} · ${tHits.map(firstAt).join(' ')} · ${tSea} badges`);
  await tab.shot(`${out}/${vp}-target.png`);

  const g1 = glowHits(since).length;
  await js(`(() => { window.__scape.world.getState().setPin2(${JSON.stringify(SUMMIT2)}); return 1; })()`);
  const mSt = await open();
  const mHits = glowHits(since).slice(g1);
  check(`${vp}: target moved, new point fetched`, mSt === 'Ok' && (await glowAt()).at === 'Target' && mHits.length === 1 && firstAt(mHits[0]) === sent(SUMMIT2), `${mSt} · ${mHits.map(firstAt).join(' ')}`);

  await js(`(() => { document.querySelector('details[data-card=alpenglow] summary').click(); return 1; })()`);
  const g2 = glowHits(since).length;
  const c0 = await stats();
  await js(`(() => { window.__scape.world.getState().setPin2(null); return 1; })()`);
  const cLabel = await glowAt();
  const cSt = await open();
  const cSea = await js<number>(`document.querySelectorAll('[data-glow-sea]').length`);
  check(`${vp}: target cleared, back to the pin from its cache`, cLabel.at === 'Pin' && /at the camera/.test(cLabel.label) && cSt === 'Ok' && glowHits(since).length === g2 && (await stats()).cacheHits === c0.cacheHits + 1 && cSea === 0, `${cLabel.label} · ${cSt} · +${glowHits(since).length - g2} requests · hits ${c0.cacheHits} → ${(await stats()).cacheHits} · ${cSea} badges`);
  await tab.shot(`${out}/${vp}-target-cleared.png`);

  // Tools › Light at a point no longer carries the forecast.
  await js(`(() => { const s = window.__scape; s.ui.getState().setPanelTab('Tools'); s.lightProbe.getState().setPoint(${JSON.stringify(SUMMIT)}); return 1; })()`);
  await until('document.querySelector(".tools")');
  await js('(() => { document.querySelectorAll(".tools details").forEach((d) => { d.open = true; }); return 1; })()');
  const oldGone = await js<boolean>('!document.querySelector(".tools [data-glow-toggle], .tools [data-glow]") && /Light at a point/.test(document.querySelector(".tools")?.textContent ?? "")');
  check(`${vp}: Tools › Light at a point has no forecast toggle`, oldGone, `gone ${oldGone}`);
  await js('(() => { window.__scape.lightProbe.getState().setPoint(null); return 1; })()');

  // Fog at the point.
  stub.value = foggy;
  await fresh();
  await js(`(() => { window.__scape.weather.getState().setModel('best_match'); return 1; })()`);
  await open();
  const fog = await js<{ score: string; why: string }>(`(() => { const r = document.querySelector('${row('sunrise')}'); return { score: r?.dataset.score ?? '', why: r?.querySelector('.glow-why')?.textContent ?? '' }; })()`);
  check(`${vp}: fog at the point scores 0`, fog.score === '0' && fog.why === 'fog at the point', `${fog.score} · ${fog.why}`);
  stub.value = westLow;

  const wide = await js<boolean>('document.documentElement.scrollWidth > window.innerWidth || [...document.querySelectorAll(".glow-list li")].some((l) => l.scrollWidth > l.clientWidth + 1)');
  check(`${vp}: no sideways scroll`, !wide, `overflow ${wide}`);
  await tab.shot(`${out}/${vp}-fog.png`);

  // Privacy off: nothing sent.
  await js(`(() => { window.__scape.settings.getState().update({ weather: false }); return 1; })()`);
  const p0 = stub.hits.length;
  await until('document.querySelector(\'[data-wx="off"]\')', 5000);
  await Bun.sleep(1000);
  const offGone = await js<boolean>('!document.querySelector("details[data-card=alpenglow]")');
  check(`${vp}: privacy off sends nothing and says so`, offGone && stub.hits.length === p0 && /off for privacy/.test(await text('[data-wx="off"]')), `section gone ${offGone} · +${stub.hits.length - p0} requests`);
  await js(`(() => { window.__scape.settings.getState().update({ weather: true }); return 1; })()`);

  const all = glowHits(since);
  check(`${vp}: requests within budget`, all.length <= MAX_REQUESTS && (await js<number>('window.__scape.weatherStats.refused')) === 0, `${all.length} forecast requests, ${all.reduce((a, h) => a + h.locations, 0)} points`);
}

await run('desktop');
await run('phone');

// One real request, so the shape is checked against Open-Meteo.
await tab.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
stub.mode = StubMode.Live;
stub.liveLeft = 0;
stub.value = null;
const since = Date.now();
await fresh();
await js(`(() => { window.__scape.weather.getState().setModel('best_match'); return 1; })()`);
// The Weather tab's own cards have asked by now; the one live request is the alpenglow one.
await Bun.sleep(2000);
stub.liveLeft = 1;
const lst = await open();
const live = stub.forecasts(since).filter((h) => h.live);
const scores = await js<string[]>(`[...document.querySelectorAll('.glow-list li[data-day="1"]')].map((l) => l.dataset.score)`);
check('desktop: one live Open-Meteo request parses', lst === 'Ok' && live.length === 1 && scores.length === 2 && scores.every((s) => /^\d+$/.test(s)) && (await js<number>('window.__scape.weatherStats.errors')) === 0, `${lst} · ${live.length} live · day 1 scores ${scores.join(', ')}`);
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
