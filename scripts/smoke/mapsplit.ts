// Map split smoke: the map's layer order at load, with feature layers on and after a basemap switch; a map → viewfinder → map
// round trip leaves no store listener or live timer behind.
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
// Usage: bun scripts/smoke/mapsplit.ts <cdp> <port> <out-dir> [baseline.json]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Tab } from './cdp';

const [cdp = '9483', port = '5483', out = '/tmp/mapsplit', baseline = ''] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(out, { recursive: true });
// Zermatt towards the Matterhorn, by day so the shadow mask is up.
const START = `${BASE}/?c=45.9763,7.6586&tg=45.9766,7.6586&t=2026-06-21T10:00Z&tz=Europe/Zurich&f=50`;
const CENTRE = [7.6586, 45.9763];

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

// Pending timeouts and intervals, by id.
const TIMERS = `(() => {
  const live = new Set();
  const st = window.setTimeout, ct = window.clearTimeout, si = window.setInterval, ci = window.clearInterval;
  window.setTimeout = function (f, ...a) { const id = st.call(window, (...b) => { live.delete(id); return typeof f === 'function' ? f(...b) : undefined; }, ...a); live.add(id); return id; };
  window.clearTimeout = (id) => { live.delete(id); ct.call(window, id); };
  window.setInterval = function (...a) { const id = si.apply(window, a); live.add(id); return id; };
  window.clearInterval = (id) => { live.delete(id); ci.call(window, id); };
  window.__liveTimers = live;
})()`;

// Net store subscriptions made from now on, per store.
const LISTENERS = `(() => {
  const net = {};
  for (const [name, s] of Object.entries(window.__scape)) {
    if (!s || typeof s.subscribe !== 'function' || typeof s.getState !== 'function') continue;
    net[name] = 0;
    const sub = s.subscribe;
    s.subscribe = (...a) => {
      net[name]++;
      const off = sub(...a);
      let done = false;
      return () => { if (!done) { done = true; net[name]--; } off(); };
    };
  }
  window.__netSubs = net;
})()`;

const tab = await Tab.open(Number(cdp), BASE);
await tab.fresh(BASE);
await tab.viewport(1400, 900, 1);
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: TIMERS });

const settle = () =>
  tab.eval(`new Promise((r) => {
    const m = window.__scapeMap;
    const t = setTimeout(r, 20000);
    const done = () => { clearTimeout(t); setTimeout(r, 500); };
    if (m.loaded() && !m.isMoving() && m.areTilesLoaded()) done(); else m.once('idle', done);
  })`, 30_000);
const layerIds = () => tab.eval<string[]>('window.__scapeMap.getStyle().layers.map((l) => l.id)');
const styleLoad = () => tab.eval(`new Promise((r) => { const t = setTimeout(r, 20000); window.__scapeMap.once('style.load', () => { clearTimeout(t); r(); }); })`, 30_000);
const set = (patch: Record<string, unknown>) => tab.eval(`void window.__scape.settings.getState().update(${JSON.stringify(patch)})`);

await tab.navigate(START);
await tab.until('!!(window.__scape && window.__scapeMap && window.__scapeMap.isStyleLoaded())', 60_000, 250);
await tab.eval(`void window.__scapeMap.jumpTo({ center: ${JSON.stringify(CENTRE)}, zoom: 15 })`);
await set({ showBuildings: false, showSunShadows: false, showSatellite: false, showLightPollution: false, showHillshade: false, showDayNight: false, terrain: true, terrain3d: false, basemapId: 'ofm-liberty' });
await settle();

const orders: Record<string, string[]> = {};
orders.load = await layerIds();
await set({ showBuildings: true, showSunShadows: true, showSatellite: true, showLightPollution: true, showHillshade: true, showDayNight: true });
await settle();
orders.featuresOn = await layerIds();
const switched = styleLoad();
await set({ basemapId: 'ofm-dark' });
await switched;
await settle();
orders.switchedOn = await layerIds();
const back = styleLoad();
await set({ showBuildings: false, showSunShadows: false, showSatellite: false, showLightPollution: false, showHillshade: false, showDayNight: false });
await set({ basemapId: 'ofm-liberty' });
await back;
await settle();
orders.switchedBackOff = await layerIds();
writeFileSync(`${out}/layer-order.json`, JSON.stringify(orders, null, 1));

if (baseline && existsSync(baseline)) {
  const want = JSON.parse(readFileSync(baseline, 'utf8')) as Record<string, string[]>;
  for (const k of Object.keys(want)) {
    const got = orders[k] ?? [];
    const same = got.join(',') === want[k].join(',');
    const at = same ? -1 : want[k].findIndex((id, i) => got[i] !== id);
    check(`layer order ${k}`, same, same ? `${got.length} layers` : `differs at ${at}: ${want[k][at]} → ${got[at]}`);
  }
} else {
  for (const [k, v] of Object.entries(orders)) check(`layer order ${k} recorded`, v.length > 0, `${v.length} layers`);
}

// Disposal: map → viewfinder → map, three times.
const clickRail = async (href: string) => {
  await tab.eval(`void document.querySelector('a.rail-link[href^="${href}"]').click()`);
  await tab.until(href === '/' ? '!!document.querySelector(".maplibregl-canvas") && !document.querySelector("canvas.vf")' : '!!document.querySelector("canvas.vf")', 30_000, 100);
};
const timers = async () => {
  let best = Infinity;
  for (let i = 0; i < 6; i++) {
    best = Math.min(best, await tab.eval<number>('window.__liveTimers.size'));
    await Bun.sleep(500);
  }
  return best;
};
const trip = async () => {
  await clickRail('/viewfinder');
  await Bun.sleep(4000);
  await clickRail('/');
  await tab.until('!!(window.__scapeMap && window.__scapeMap.isStyleLoaded())', 60_000, 250);
  await settle();
  return { net: await tab.eval<Record<string, number>>('({ ...window.__netSubs })'), timers: await timers() };
};
// The first trip replaces every map-side subscription with a counted one; later trips must leave the count where it was.
await tab.eval(LISTENERS);
const first = await trip();
const sum = (n: Record<string, number>) => Object.values(n).reduce((a, b) => a + b, 0);
const diff = (n: Record<string, number>) => Object.keys(first.net).filter((k) => n[k] !== first.net[k]).map((k) => `${k} ${first.net[k]} → ${n[k]}`);
for (let i = 2; i <= 3; i++) {
  const t = await trip();
  check(`round trip ${i}: store listeners unchanged`, diff(t.net).length === 0, diff(t.net).join(', ') || `${sum(t.net)} live after the first trip, still ${sum(t.net)}`);
  check(`round trip ${i}: live timers do not grow`, t.timers <= first.timers, `${first.timers} after the first trip, now ${t.timers}`);
}

tab.close();
console.log('| check | result | detail |\n|---|---|---|');
for (const r of rows) console.log(r);
process.exit(failed ? 1 : 0);
