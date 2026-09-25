// Map click-mode picker and right-click / long-press menu, desktop and phone.
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
// Usage: bun scripts/smoke/mapctl.ts <cdp> <dev-port> <shot-dir>
import { mkdirSync } from 'node:fs';
import { Tab } from './cdp';

const [cdp = '9440', port = '5440', shots = '/tmp/mapctl'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });
// Rotterdam, Erasmusbrug towards the Maastoren.
const START = `${BASE}/?camera=51.9050,4.4830&target=51.9153,4.4890&t=2026-10-18T11:00Z`;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

// Headless: a background-created tab stays hidden and never acks touch input, so start from a visible one.
const pages = (await (await fetch(`http://localhost:${cdp}/json/list`)).json()) as { type: string; url: string }[];
if (!pages.some((p) => p.type === "page" && (p.url.startsWith(BASE) || p.url === "about:blank"))) await fetch(`http://localhost:${cdp}/json/new?about:blank`, { method: "PUT" });
const tab = await Tab.open(Number(cdp), pages.some((p) => p.url.startsWith(BASE)) ? BASE : "about:blank");
await tab.fresh(BASE);
if (!(await tab.eval<boolean>("document.visibilityState === \"visible\""))) throw new Error("the smoke tab is hidden; touch input would hang");
type P = { lng: number; lat: number };
type World = { pin: P; pin2: P | null };

const world = () => tab.eval<World>('(() => { const w = __scape.world.getState(); return { pin: w.pin, pin2: w.pin2 }; })()');
const mode = () => tab.eval<string>('__scape.settings.getState().clickMode');
const markers = () => tab.eval<number>('__scape.markers.getState().markers.length');
const menuOpen = () => tab.eval<boolean>('!!document.querySelector(".map-menu")');
const near = (a: P | null | undefined, b: P, eps = 1e-6) => !!a && Math.abs(a.lng - b.lng) < eps && Math.abs(a.lat - b.lat) < eps;
const fmt = (p: P | null | undefined) => (p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : 'null');
const sleep = (ms: number) => Bun.sleep(ms);

/** A client point at fractions of the canvas, nudged until nothing but the canvas is under it; with its lng/lat. */
async function spot(fx: number, fy: number): Promise<{ x: number; y: number; ll: P }> {
  return tab.eval(`(() => {
    const r = __scapeMap.getCanvas().getBoundingClientRect();
    for (let k = 0; k < 121; k++) {
      const x = Math.round(r.left + r.width * ${fx} + ((k % 11) - 5) * 9), y = Math.round(r.top + r.height * ${fy} + (Math.floor(k / 11) - 5) * 9);
      if (document.elementFromPoint(x, y) !== __scapeMap.getCanvas()) continue;
      if (__scapeMap.getLayer('markers-circle') && __scapeMap.queryRenderedFeatures([x - r.left, y - r.top], { layers: ['markers-circle'] }).length) continue;
      const ll = __scapeMap.unproject([x - r.left, y - r.top]);
      return { x, y, ll: { lng: ll.lng, lat: ll.lat } };
    }
    throw new Error('no clear spot');
  })()`);
}

const MOD = { Alt: 1, Shift: 8 } as const;
async function mouse(type: string, x: number, y: number, button = 'left', modifiers = 0, clickCount = 1) {
  const buttons = type === 'mouseReleased' ? 0 : button === 'right' ? 2 : button === 'left' && type !== 'mouseMoved' ? 1 : 0;
  await tab.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, modifiers, clickCount });
}
async function click(x: number, y: number, modifiers = 0, button = 'left') {
  await mouse('mouseMoved', x, y, 'none', modifiers);
  await mouse('mousePressed', x, y, button, modifiers);
  await mouse('mouseReleased', x, y, button, modifiers);
  await sleep(250);
}
async function key(k: string, code: number, text?: string) {
  await tab.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(text && { text }) });
  await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
  await sleep(150);
}
async function touch(type: string, pts: { x: number; y: number }[]) {
  await tab.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
}

/** Fewest rAF callbacks over up to three 3 s windows, so late tile loads do not count. */
async function quiet(): Promise<{ raf: number; timers: number }> {
  let best = { raf: Infinity, timers: Infinity };
  for (let i = 0; i < 3 && best.raf > 0; i++) {
    await tab.eval('__scape.idle.reset()');
    await sleep(3000);
    const n = await tab.eval<{ raf: number; timers: number }>('({ raf: __scape.idle.raf, timers: __scape.idle.timers })');
    if (n.raf < best.raf) best = n;
  }
  return best;
}

async function load(url = START) {
  await tab.navigate(url);
  const ok = await tab.until('window.__scape && window.__scapeMap && __scapeMap.loaded() && document.querySelector(".click-mode button")', 30_000, 250);
  if (!ok) throw new Error('map did not load');
  await tab.until('__scapeMap.areTilesLoaded()', 15_000, 250);
  await tab.eval('(() => { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; return 1; })()');
}

const picker = () =>
  tab.eval<{ n: number; modes: string[]; icon: string; pressed: string | null; open: boolean }>(`(() => {
    const el = document.querySelector('.click-mode');
    const bs = [...el.querySelectorAll('button')];
    return { n: bs.length, modes: bs.map((b) => b.dataset.mode), icon: bs[0].innerHTML, pressed: el.querySelector('[aria-pressed="true"]')?.dataset.mode ?? null, open: el.classList.contains('open') };
  })()`);
const pickerButton = (sel: string) =>
  tab.eval<{ x: number; y: number }>(`(() => { const r = document.querySelector('.click-mode ${sel}').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);

async function setModeViaPicker(m: string) {
  const c = await pickerButton('button');
  await click(c.x, c.y);
  const o = await pickerButton(`button[data-mode="${m}"]`);
  await click(o.x, o.y);
}

async function run(vp: 'desktop' | 'phone') {
  const [w, h] = vp === 'desktop' ? [1400, 900] : [390, 844];
  await tab.viewport(w, h);
  await load();
  await tab.eval('(() => { __scape.settings.getState().update({ clickMode: "camera" }); return 1; })()');
  await sleep(200);

  // Picker: collapsed icon per mode, expand, choose, Escape and outside click.
  const icons: Record<string, string> = {};
  for (const m of ['target', 'off', 'camera']) {
    await setModeViaPicker(m);
    const p = await picker();
    icons[m] = p.icon;
    check(`${vp} picker: choosing ${m} collapses to its icon`, p.n === 1 && p.modes[0] === m && !p.open && (await mode()) === m, `${p.n} button, shows ${p.modes[0]}, store ${await mode()}`);
  }
  check(`${vp} picker: the three icons differ`, new Set(Object.values(icons)).size === 3, Object.keys(icons).join('/'));
  {
    const c = await pickerButton('button');
    await click(c.x, c.y);
    const p = await picker();
    check(`${vp} picker: expands into Camera / Target / Off`, p.n === 3 && p.modes.join() === 'camera,target,off' && p.pressed === 'camera' && p.open, `${p.modes.join()} pressed ${p.pressed}`);
    const title = await tab.eval<string>('document.querySelector(".click-mode button").title');
    check(`${vp} picker: titles name the Shift and Alt shortcuts`, /Shift-click/.test(title) && /Alt-click/.test(title), title);
    await tab.shot(`${shots}/${vp}-picker-open.png`);
    await key('Escape', 27);
    const e = await picker();
    check(`${vp} picker: Escape collapses`, e.n === 1 && !e.open, `${e.n} button`);
    await click(c.x, c.y);
    const before = await world();
    const s = await spot(0.3, 0.6);
    await click(s.x, s.y);
    const after = await world();
    const o = await picker();
    check(`${vp} picker: an outside click collapses it without moving the camera`, o.n === 1 && near(after.pin, before.pin), `${o.n} button, pin ${fmt(after.pin)}`);
  }

  // Plain clicks per mode.
  for (const [m, fx] of [['camera', 0.25], ['target', 0.35], ['off', 0.45]] as const) {
    await setModeViaPicker(m);
    const before = await world();
    const s = await spot(fx, 0.55);
    await click(s.x, s.y);
    const after = await world();
    const ok = m === 'camera' ? near(after.pin, s.ll) && near(after.pin2, before.pin2!) : m === 'target' ? near(after.pin2, s.ll) && near(after.pin, before.pin) : near(after.pin, before.pin) && near(after.pin2, before.pin2!);
    check(`${vp} mode ${m}: a plain click ${m === 'off' ? 'moves nothing' : `sets the ${m}`}`, ok, `camera ${fmt(after.pin)}, target ${fmt(after.pin2)}`);
  }
  // Shortcuts, from Off.
  {
    const s = await spot(0.3, 0.7);
    await click(s.x, s.y, MOD.Shift);
    check(`${vp} Shift-click sets the target in Off mode`, near((await world()).pin2, s.ll), fmt((await world()).pin2));
    const n0 = await markers();
    const a = await spot(0.4, 0.7);
    await click(a.x, a.y, MOD.Alt);
    await tab.until(`__scape.markers.getState().markers.length > ${n0}`, 3000, 100);
    check(`${vp} Alt-click adds a marker`, (await markers()) === n0 + 1, `${n0} → ${await markers()}`);
  }
  await setModeViaPicker('camera');

  // Right-click menu and its items.
  const rightClick = async (s: { x: number; y: number }) => {
    await click(s.x, s.y, 0, 'right');
    await tab.until('document.querySelector(".map-menu")', 2000, 100);
  };
  {
    const s = await spot(0.6, 0.5);
    await rightClick(s);
    const m = await tab.eval<{ items: string[]; r: { left: number; top: number; right: number; bottom: number }; focus: string }>(`(() => {
      const el = document.querySelector('.map-menu');
      return { items: [...el.querySelectorAll('[role=menuitem]')].map((b) => b.firstChild.textContent), r: el.getBoundingClientRect().toJSON(), focus: document.activeElement?.textContent ?? '' };
    })()`);
    check(`${vp} right-click opens the menu`, m.items.join('|') === 'Camera here|Target here|Add marker|Copy coordinates', m.items.join('|'));
    check(`${vp} menu opens at the pointer, inside the viewport`, Math.abs(m.r.left - s.x) < 2 || Math.abs(m.r.right - s.x) < 2, `menu ${Math.round(m.r.left)},${Math.round(m.r.top)} pointer ${s.x},${s.y}`);
    await tab.shot(`${shots}/${vp}-menu.png`);
    const nb = await tab.eval<boolean>('(() => { const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); document.querySelector(".map-menu").dispatchEvent(e); return e.defaultPrevented; })()');
    const nm = await tab.eval<boolean>('(() => { const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); document.querySelector(".tabs button, .rail button, button").dispatchEvent(e); return e.defaultPrevented; })()');
    check(`${vp} native menu is blocked only on the map canvas`, !nb && !nm, `menu blocked ${nb}, panel blocked ${nm}`);
    await key('Escape', 27);
    check(`${vp} Escape closes the menu`, !(await menuOpen()), '');

    const item = async (label: string, at: { x: number; y: number }) => {
      await rightClick(at);
      const b = await tab.eval<{ x: number; y: number }>(`(() => { const b = [...document.querySelectorAll('.map-menu [role=menuitem]')].find((e) => e.firstChild.textContent === '${label}'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; })()`);
      await click(b.x, b.y);
    };
    const c1 = await spot(0.2, 0.4);
    await item('Camera here', c1);
    check(`${vp} menu: Camera here`, near((await world()).pin, c1.ll) && !(await menuOpen()), fmt((await world()).pin));
    const t1 = await spot(0.3, 0.4);
    await item('Target here', t1);
    check(`${vp} menu: Target here`, near((await world()).pin2, t1.ll), fmt((await world()).pin2));
    const n0 = await markers();
    const m1 = await spot(0.4, 0.4);
    await item('Add marker', m1);
    await tab.until(`__scape.markers.getState().markers.length > ${n0}`, 3000, 100);
    const last = await tab.eval<P>('(() => { const ms = __scape.markers.getState().markers; const m = ms[ms.length - 1]; return { lng: m.lng, lat: m.lat }; })()').catch(() => null);
    check(`${vp} menu: Add marker`, (await markers()) === n0 + 1, `${n0} → ${await markers()} at ${fmt(last)}`);
    const k1 = await spot(0.5, 0.4);
    await tab.eval('window.__copied = null');
    await rightClick(k1);
    const shown = await tab.eval<string>('document.querySelector(".map-menu .detail").textContent');
    const b = await tab.eval<{ x: number; y: number }>(`(() => { const r = document.querySelector('.map-menu .detail').getBoundingClientRect(); return { x: Math.round(r.left + 5), y: Math.round(r.top + 4) }; })()`);
    await click(b.x, b.y);
    const copied = await tab.eval<string | null>('window.__copied');
    const want = await tab.eval<string>(`(() => { const f = __scape.settings.getState().coordFormat; return f; })()`);
    check(`${vp} menu: Copy coordinates writes the shown ${want} text`, !!copied && copied === shown && /\d/.test(copied), `${copied}`);

    // Keyboard: ArrowDown twice from the first item, then Enter adds a marker.
    const kb = await spot(0.6, 0.35);
    const n1 = await markers();
    await rightClick(kb);
    await key('ArrowDown', 40);
    await key('ArrowDown', 40);
    const f = await tab.eval<string>('document.activeElement?.firstChild?.textContent ?? ""');
    await key('Enter', 13, '\r');
    await tab.until(`__scape.markers.getState().markers.length > ${n1}`, 3000, 100);
    check(`${vp} menu: arrow keys and Enter`, f === 'Add marker' && (await markers()) === n1 + 1 && !(await menuOpen()), `focused "${f}", markers ${n1} → ${await markers()}`);
    await rightClick(kb);
    await key('ArrowUp', 38);
    const up = await tab.eval<string>('document.activeElement?.firstChild?.textContent ?? ""');
    check(`${vp} menu: ArrowUp wraps to the last item`, up === 'Copy coordinates', up);

    // Outside click closes without moving the camera; a map move closes it.
    const before = await world();
    const o = await spot(0.15, 0.75);
    await click(o.x, o.y);
    check(`${vp} menu: an outside click closes it without moving the camera`, !(await menuOpen()) && near((await world()).pin, before.pin), fmt((await world()).pin));
    await rightClick(kb);
    await tab.eval('(() => { __scapeMap.panBy([20, 0], { duration: 0 }); return 1; })()');
    await sleep(200);
    check(`${vp} menu: a map move closes it`, !(await menuOpen()), '');
  }

  // Phone edge: right-click near the bottom-right corner stays inside.
  {
    const e = await spot(0.93, 0.9);
    await click(e.x, e.y, 0, 'right');
    await tab.until('document.querySelector(".map-menu")', 2000, 100);
    const r = await tab.eval<{ left: number; top: number; right: number; bottom: number } | null>('document.querySelector(".map-menu")?.getBoundingClientRect().toJSON() ?? null');
    check(`${vp} menu near the corner stays inside the viewport`, !!r && r.left >= 0 && r.top >= 0 && r.right <= w && r.bottom <= h, r ? `${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)} in ${w}×${h}` : 'no menu');
    const wide = await tab.eval<boolean>('document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth');
    check(`${vp} no sideways scroll with the menu open`, !wide, `overflow ${wide}`);
    const q = await quiet();
    check(`${vp} idle with the menu open: 0 rAF`, q.raf === 0, `rAF ${q.raf}, timers ${q.timers} / 3 s`);
    await key('Escape', 27);
  }
  {
    const q = await quiet();
    check(`${vp} idle with the menu closed: 0 rAF`, q.raf === 0, `rAF ${q.raf}, timers ${q.timers} / 3 s`);
    const c = await pickerButton('button');
    await click(c.x, c.y);
    const qp = await quiet();
    check(`${vp} idle with the picker open: 0 rAF`, qp.raf === 0, `rAF ${qp.raf}, timers ${qp.timers} / 3 s`);
    await key('Escape', 27);
  }

  // Right-drag rotates without a menu.
  {
    const s = await spot(0.5, 0.5);
    const b0 = await tab.eval<number>('__scapeMap.getBearing()');
    await mouse('mouseMoved', s.x, s.y, 'none');
    await mouse('mousePressed', s.x, s.y, 'right');
    for (let i = 1; i <= 12; i++) {
      await mouse('mouseMoved', s.x + i * 6, s.y, 'right');
      await sleep(16);
    }
    await mouse('mouseReleased', s.x + 72, s.y, 'right');
    await sleep(400);
    const b1 = await tab.eval<number>('__scapeMap.getBearing()');
    check(`${vp} right-drag rotates without a menu`, Math.abs(b1 - b0) > 1 && !(await menuOpen()), `bearing ${b0.toFixed(1)} → ${b1.toFixed(1)}, menu ${await menuOpen()}`);
    await tab.eval('(() => { __scapeMap.jumpTo({ bearing: 0, pitch: 0 }); return 1; })()');
    await sleep(300);
  }

  // Touch: long-press opens, a drag does not, a tap still sets the camera.
  await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  {
    const s = await spot(0.4, 0.5);
    await touch('touchStart', [s]);
    await sleep(700);
    const open = await menuOpen();
    await touch('touchEnd', []);
    await sleep(300);
    const still = await menuOpen();
    const pin = (await world()).pin;
    check(`${vp} long-press opens the menu and the lift does not pick an item`, open && still && !near(pin, s.ll), `open ${open}, after lift ${still}`);
    await tab.shot(`${shots}/${vp}-longpress.png`);
    await key('Escape', 27);
    const d = await spot(0.4, 0.5);
    await touch('touchStart', [d]);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [{ x: d.x + i * 5, y: d.y + i * 3 }]);
      await sleep(30);
    }
    await sleep(600);
    const dragOpen = await menuOpen();
    await touch('touchEnd', []);
    await sleep(300);
    check(`${vp} a touch drag opens no menu`, !dragOpen && !(await menuOpen()), `menu ${dragOpen}`);
    const p2 = await spot(0.5, 0.5);
    await touch('touchStart', [p2, { x: p2.x + 80, y: p2.y + 40 }]);
    await sleep(700);
    const pinchOpen = await menuOpen();
    await touch('touchEnd', []);
    await sleep(300);
    check(`${vp} a two-finger hold opens no menu`, !pinchOpen, `menu ${pinchOpen}`);
    const t = await spot(0.3, 0.45);
    await touch('touchStart', [t]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(500);
    check(`${vp} a tap still sets the camera`, near((await world()).pin, t.ll, 1e-4) && !(await menuOpen()), fmt((await world()).pin));
  }
  await tab.send('Emulation.setTouchEmulationEnabled', { enabled: false });

  const wide = await tab.eval<boolean>('document.documentElement.scrollWidth > window.innerWidth');
  check(`${vp} no sideways page scroll`, !wide, `overflow ${wide}`);
  await tab.shot(`${shots}/${vp}-map.png`);
}

async function migration() {
  for (const [old, want] of [[false, 'off'], [true, 'camera']] as const) {
    await tab.eval(`(() => {
      const raw = JSON.parse(localStorage.getItem('scape.settings') ?? '{"state":{}}');
      const { clickMode: _c, ...rest } = raw.state;
      localStorage.setItem('scape.settings', JSON.stringify({ state: { ...rest, clickMovesPin: ${old} }, version: 0 }));
      return 1;
    })()`);
    await load();
    const stored = await tab.eval<{ version: number; mode: string; old: boolean }>(`(() => { const r = JSON.parse(localStorage.getItem('scape.settings')); return { version: r.version, mode: r.state.clickMode, old: 'clickMovesPin' in r.state }; })()`);
    const p = await picker();
    check(`migration: clickMovesPin ${old} → ${want}`, (await mode()) === want && p.modes[0] === want && stored.version === 1 && stored.mode === want && !stored.old, `store ${await mode()}, icon ${p.modes[0]}, stored v${stored.version} ${stored.mode}, old key ${stored.old}`);
  }
}

try {
  for (const vp of ['desktop', 'phone'] as const) await run(vp);
  await tab.viewport(1400, 900);
  await migration();
  await tab.eval('(() => { __scape.settings.getState().update({ clickMode: "camera" }); return 1; })()');
} catch (e) {
  check('smoke ran to the end', false, String(e));
}
tab.close();
console.log('| Check | Result | Detail |\n|---|---|---|');
console.log(rows.join('\n'));
process.exit(failed ? 1 : 0);
