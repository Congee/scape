// Models A/B picks smoke: the sheet folds away while drawing on a phone and reopens with the model in view, and a model saved without its ground warns why.
/* oxlint-disable no-await-in-loop -- smoke steps run one at a time */
// Usage: bun scripts/smoke/pickmodels.ts <cdp> <dev-port> <shot-dir>
import { Tab } from './cdp';

const [cdp = '9500', port = '5500', shots = '/tmp/pickmodels'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
// Bryant Park's lawn to draw on.
const LAWN = { lat: 40.7536, lng: -73.9837 };
// Far from anything cached, so the DEM there must be fetched; a new spot per run.
const nowhere = () => ({ lat: 38.2 + Math.random() * 0.5, lng: -116.9 + Math.random() * 0.5 });
const DEM_URLS = ['*mapterhorn.com*', '*elevation-tiles-prod*'];
const PHONE = { w: 390, h: 844 };
const DESKTOP = { w: 1280, h: 800 };
const SMOKE_NOTE = 'pickmodels-smoke';

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
await tab.fresh(BASE);

const HELPERS = `(async () => {
  if (window.__smoke) return true;
  const S = window.__scape;
  const map = () => window.__scapeMap;
  const idle = async () => { const m = map(); m.triggerRepaint(); return new Promise((r) => { const t = setTimeout(() => r(false), 20000); m.once('idle', () => { clearTimeout(t); r(true); }); }); };
  const canvas = () => { const r = map().getCanvas().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  /** Where a ring's bbox centre lands, as a share of the map canvas. */
  const share = (ring) => {
    const lngs = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
    const p = map().project([(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2]), c = canvas();
    return { x: p.x / c.w, y: p.y / c.h };
  };
  const selected = () => { const s = S.models.getState(); return s.models.find((m) => m.id === s.selectedId) ?? null; };
  const hidden = (sel) => { const e = document.querySelector(sel); return !e || getComputedStyle(e).display === 'none'; };
  window.__smoke = { S, map, idle, canvas, share, selected, hidden };
  return true;
})()`;
const js = <T = unknown>(body: string, timeoutMs = 60_000) =>
  tab.eval<T>(`(async () => { await ${HELPERS}; const { S, map, idle, canvas, share, selected, hidden } = window.__smoke; ${body} })()`, timeoutMs);
const settle = (ms = 1000) => Bun.sleep(ms);
const tap = async (x: number, y: number) => {
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await settle(250);
};
const click = (label: string, scope = 'body') =>
  tab.eval<boolean>(
    `(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((b) => !b.disabled && (b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)})); b?.click(); return !!b; })()`
  );
const openModels = () => js(`S.ui.getState().setPanelTab('Markers'); S.ui.getState().setMarkersView('Models'); return true;`);
const home = async () => {
  await tab.navigate(`${BASE}/`);
  await tab.until('!!window.__scape?.models?.getState().loaded && !!window.__scapeMap', 60_000);
};
/** Taps a square in the top quarter of the map, which the reopened sheet would push off the top. */
const topTaps = () =>
  js<{ x: number; y: number }[]>(`
  const c = canvas(), cx = c.x + c.w / 2, cy = c.y + 90 + 50, d = 45;
  return [{ x: cx - d, y: cy - d }, { x: cx + d, y: cy - d }, { x: cx + d, y: cy + d }, { x: cx - d, y: cy + d }];
`);
const sheet = () =>
  js<{ collapsed: boolean; body: boolean; mapH: number; tabTappable: boolean }>(`
  const t = document.querySelector('.tabs button'), r = t?.getBoundingClientRect();
  return { collapsed: S.ui.getState().panelCollapsed, body: !hidden('.tab-body'), mapH: canvas().h, tabTappable: !!r && r.height > 0 && t.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
`);
const inView = (s: { x: number; y: number }) => s.x > 0.2 && s.x < 0.8 && s.y > 0.2 && s.y < 0.8;
const pct = (s: { x: number; y: number }) => `${Math.round(s.x * 100)} %, ${Math.round(s.y * 100)} %`;

// Phone: the sheet folds while drawing.
await tab.viewport(PHONE.w, PHONE.h);
await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await home();
if (!(await js<boolean>('return !!S.ui;'))) throw new Error('window.__scape.ui missing');
await js(`for (const m of S.models.getState().models.filter((m) => m.notes === '${SMOKE_NOTE}')) await S.models.getState().remove(m.id); S.ui.getState().setPanelCollapsed(false); return true;`);
await openModels();
await js(`map().jumpTo({ center: [${LAWN.lng}, ${LAWN.lat}], zoom: 17, pitch: 0, bearing: 0 }); await idle(); return true;`);
await settle();
const open0 = await sheet();
await click('Draw a building');
await tab.until('window.__scape.models.getState().draft !== null', 5000, 100);
await settle();
const folded = await sheet();
await tab.shot(`${shots}/phone-folded.png`);
check(
  'phone: sheet folds while drawing, tab row stays tappable',
  open0.body && !open0.collapsed && folded.collapsed && !folded.body && folded.tabTappable && folded.mapH > open0.mapH + 150,
  `map ${Math.round(open0.mapH)} → ${Math.round(folded.mapH)} px; tab row ${folded.tabTappable ? 'tappable' : 'covered'}`
);

// Tapping the tab row mid-draft brings the sheet back with the draft still centred.
const taps = await topTaps();
for (const t of taps.slice(0, 3)) await tap(t.x, t.y);
const before = await js<{ x: number; y: number }>('return share(S.models.getState().draft);');
await tab.eval(`document.querySelector('.tabs button.on, .tabs button')?.click()`);
await settle(1500);
const mid = await js<{ s: { x: number; y: number }; n: number; collapsed: boolean }>('return { s: share(S.models.getState().draft), n: S.models.getState().draft?.length ?? -1, collapsed: S.ui.getState().panelCollapsed };');
await tab.shot(`${shots}/phone-reopened-mid-draft.png`);
check('phone: sheet reopened mid-draft keeps the draft in view', !mid.collapsed && mid.n === 3 && inView(mid.s), `draft at ${pct(before)} folded → ${pct(mid.s)} of the shrunk map`);
await click('Cancel');
await settle();

// Closing the ring reopens the sheet on the new model.
await click('Draw a building');
await tab.until('window.__scape.models.getState().draft !== null', 5000, 100);
await settle();
const n0 = await js<number>('return S.models.getState().models.length;');
const taps2 = await topTaps();
for (const t of taps2) await tap(t.x, t.y);
await tap(taps2[0].x, taps2[0].y);
const made = await tab.until<string>(`(() => { const s = window.__scape.models.getState(); return !s.draft && s.models.length > ${n0} && s.selectedId; })()`, 15_000, 200);
if (made) await js(`await S.models.getState().update(${JSON.stringify(made)}, { notes: '${SMOKE_NOTE}' }); return true;`);
await settle(1500);
const after = await js<{ s: { x: number; y: number } | null; collapsed: boolean; editor: boolean }>(
  `const m = selected(); return { s: m && share(m.footprint), collapsed: S.ui.getState().panelCollapsed, editor: !!document.querySelector('.model-editor') };`
);
await tab.shot(`${shots}/phone-drawn.png`);
check(
  'phone: sheet reopens after Done with the model in view',
  !!made && !after.collapsed && after.editor && !!after.s && inView(after.s),
  after.s ? `model at ${pct(after.s)} of the map; sheet ${after.collapsed ? 'folded' : 'open'}` : 'no model'
);

// Desktop: the sheet never folds.
await tab.viewport(DESKTOP.w, DESKTOP.h);
await tab.send('Emulation.setTouchEmulationEnabled', { enabled: false });
await home();
await openModels();
await click('Draw a building');
await tab.until('window.__scape.models.getState().draft !== null', 5000, 100);
await settle(500);
const desk = await sheet();
await click('Cancel');
check('desktop: the panel stays open while drawing', !desk.collapsed && desk.body, desk.collapsed ? 'folded' : 'open');

/** Draws a square at an uncached spot through the store and Done; the saved model's id. */
const drawNowhere = async () => {
  const at = nowhere();
  await js(`map().jumpTo({ center: [${at.lng}, ${at.lat}], zoom: 17 }); return true;`);
  const n = await js<number>('return S.models.getState().models.length;');
  const d = 0.0003;
  await js(`S.models.getState().setDraft(${JSON.stringify([
    [at.lng - d, at.lat - d],
    [at.lng + d, at.lat - d],
    [at.lng + d, at.lat + d],
    [at.lng - d, at.lat + d]
  ])}); return true;`);
  await settle(300);
  await click('Done');
  const id = await tab.until<string>(`(() => { const s = window.__scape.models.getState(); return s.models.length > ${n} && s.selectedId; })()`, 60_000, 250);
  if (id) await js(`await S.models.getState().update(${JSON.stringify(id)}, { notes: '${SMOKE_NOTE}' }); return true;`);
  return id;
};
const warning = () =>
  js<{ text: string | null; retry: boolean; groundM: number | null }>(
    `const e = document.querySelector('[data-testid="ground-unknown"]'), m = selected(); return { text: e?.textContent ?? null, retry: !!e && [...e.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Try again'), groundM: m ? (Number.isNaN(m.groundM) ? null : m.groundM) : null };`
  );
let blocked: string[] = [];
const blockIn = async (s?: string) => {
  await tab.send('Network.enable', {}, s).catch(() => {});
  await tab.send('Network.setBlockedURLs', { urls: blocked }, s).catch(() => {});
};
// Workers start lazily, some after the block.
tab.workerSetup.push((s) => blockIn(s));
const block = async (urls: string[]) => {
  blocked = urls;
  for (const s of [undefined, ...tab.workerSessions().map(([id]) => id)]) await blockIn(s);
};

// Spotty network: the DEM fetch fails while online; the warning offers Try again, which heals it.
await block(DEM_URLS);
const spotty = await drawNowhere();
await settle(500);
const w1 = await warning();
await tab.shot(`${shots}/ground-spotty.png`);
check(
  'ground unknown online: saved at sea level, warning offers Try again',
  !!spotty && w1.groundM === null && !!w1.text && /did not answer/.test(w1.text) && w1.retry,
  `"${w1.text ?? 'no warning'}"`
);
await block([]);
await click('Try again', '[data-testid="ground-unknown"]');
const healed = await tab.until<number>(
  `(() => { const s = window.__scape.models.getState(), m = s.models.find((m) => m.id === ${JSON.stringify(spotty ?? '')}); return m && !Number.isNaN(m.groundM) && !document.querySelector('[data-testid="ground-unknown"]') && m.groundM + 1e-9; })()`,
  60_000,
  300
);
await tab.shot(`${shots}/ground-healed.png`);
check('Try again reads the ground and clears the warning', !!healed, healed ? `ground ${healed.toFixed(1)} m` : 'still at sea level');

// Offline: the terrain there isn't downloaded, and no Try again.
await tab.setOffline(true);
const off = await drawNowhere();
await settle(500);
const w2 = await warning();
await tab.shot(`${shots}/ground-offline.png`);
check('ground unknown offline: says the terrain is not downloaded', !!off && w2.groundM === null && !!w2.text && /isn't downloaded/.test(w2.text) && !w2.retry, `"${w2.text ?? 'no warning'}"`);
await tab.setOffline(false);
await settle(500);
const w3 = await warning();
check('back online, the same warning offers Try again', w3.retry, `"${w3.text ?? 'no warning'}"`);

// Phone layout of the warning.
await tab.viewport(PHONE.w, PHONE.h);
await settle(800);
const fit = await tab.eval<{ w: number; overflow: number } | null>(
  `(() => { const e = document.querySelector('[data-testid="ground-unknown"]'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { w: r.right, overflow: document.documentElement.scrollWidth - innerWidth }; })()`
);
await tab.shot(`${shots}/ground-phone.png`);
check('phone: the warning fits 390 px', !!fit && fit.w <= PHONE.w && fit.overflow <= 0, fit ? `right edge ${Math.round(fit.w)} px, overflow ${fit.overflow} px` : 'no warning');

await tab.viewport(DESKTOP.w, DESKTOP.h);
await js(`for (const m of S.models.getState().models.filter((m) => m.notes === '${SMOKE_NOTE}')) await S.models.getState().remove(m.id); return true;`);
tab.close();

console.log(['| check | result | detail |', '| --- | --- | --- |', ...rows].join('\n'));
process.exit(failed ? 1 : 0);
