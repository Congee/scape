// Viewfinder mesh pool smoke: rebuilds into reused buffers draw the same picture, and the canvas fills the window at full resolution.
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
// Usage: bun scripts/smoke/meshpool.ts <cdp> <port> [shot-dir]
import { mkdirSync } from 'node:fs';
import { decodePng } from '../../src/lib/core/terrain/png';
import { Tab } from './cdp';

const [cdp = '9730', port = '5730', shots = `${process.env.TMPDIR ?? '/tmp'}/meshpool`] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });
// De Rotterdam from the Maas: terrain plus 3DBAG buildings in the frame.
const CAMERA = '51.9091,4.4868';
const TARGET = '51.90664,4.48805';
const TIMES = { day: '2026-06-21T13:00Z', night: '2026-06-21T23:00Z' } as const;
const FOCALS = [24, 200, 600, 2400];

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

// Counts mesh answers and buffers handed back to the terrain worker; settled means every level is on the GPU.
const HELPERS = `(() => {
  if (window.__mp) return true;
  const S = window.__scape;
  const mp = { mesh: 0, recycled: 0 };
  const post = Worker.prototype.postMessage;
  const hooked = new WeakSet();
  Worker.prototype.postMessage = function (msg, ...rest) {
    if (msg && msg.kind === 'Recycle') mp.recycled += msg.buffers.length;
    if (msg && msg.kind === 'Mesh' && !hooked.has(this)) {
      hooked.add(this);
      this.addEventListener('message', (e) => { if (e.data?.kind === 'Mesh' && e.data.result) mp.mesh++; });
    }
    return post.call(this, msg, ...rest);
  };
  mp.settled = () => {
    const t = S.terrain.getState(), p = S.prism;
    return !t.busy.Mesh && !t.busy.View && t.mesh.length > 0 && t.mesh.length === t.mesh[0].levels && !!p?.terrain && p.terrain.levels === t.mesh.length && !S.buildings.getState().busy && !p.lod2?.busy;
  };
  mp.frame = () => {
    const r = document.querySelector('canvas.vf').getBoundingClientRect(), f = S.prism.cam.frame;
    return { x: r.left + f.x, y: r.top + f.y, w: f.w, h: f.h };
  };
  mp.fill = () => {
    const area = document.querySelector('.vf-area').getBoundingClientRect(), gl = document.querySelector('canvas.vf-gl'), r = gl.getBoundingClientRect();
    const ctx = gl.getContext('webgl2'), dpr = devicePixelRatio, f = S.prism.cam.frame;
    return { dpr, win: [innerWidth, innerHeight], area: [area.width, area.height], css: [r.width, r.height], canvas: [gl.width, gl.height], buffer: [ctx.drawingBufferWidth, ctx.drawingBufferHeight], frame: [f.w, f.h], render: [S.prism.rw, S.prism.rh] };
  };
  window.__mp = mp;
  return true;
})()`;

const tab = await Tab.open(Number(cdp), BASE);
// A service worker left by a production build on this port would serve that build instead of the dev server.
await tab.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'service_workers,cache_storage' });
await tab.fresh(BASE);

const go = async (url: string) => {
  await tab.eval("try { localStorage.removeItem('scape.composition') } catch {}");
  await tab.navigate(url);
  await tab.until('!!(window.__scape && document.querySelector("canvas.vf"))', 30_000, 250);
  await tab.eval(HELPERS);
  await tab.eval('window.__scape.ui.setState({ panelCollapsed: true })');
};
const settle = async () => {
  const ok = await tab.until('!!window.__scape.prism && window.__mp.settled()', 90_000, 250);
  await Bun.sleep(1500);
  return !!ok && (await tab.eval<boolean>('window.__mp.settled()'));
};
const url = (f: number, portrait: boolean, time: keyof typeof TIMES) => `${BASE}/viewfinder?camera=${CAMERA}&target=${TARGET}&t=${TIMES[time]}&f=${f}${portrait ? '&o=p' : ''}`;

type Rect = { x: number; y: number; w: number; h: number };
type Fill = { dpr: number; win: number[]; area: number[]; css: number[]; canvas: number[]; buffer: number[]; frame: number[]; render: number[] };
const eq = (a: number[], b: number[], tol = 1) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
/** The canvas covers its area at full device resolution, and the picture is rendered at the frame's device size. */
const fillCheck = async (tag: string) => {
  const f = await tab.eval<Fill>('window.__mp.fill()');
  const full = eq(f.css, f.area) && eq(f.canvas, [f.css[0] * f.dpr, f.css[1] * f.dpr]) && eq(f.buffer, f.canvas, 0) && eq(f.render, [f.frame[0] * f.dpr, f.frame[1] * f.dpr]);
  const letterbox = `${Math.round(f.area[0] - f.frame[0])}×${Math.round(f.area[1] - f.frame[1])} css px`;
  check(`${tag} canvas fills the view at full resolution`, full, `window ${f.win.join('×')} @${f.dpr}, area ${f.area.map(Math.round).join('×')}, buffer ${f.buffer.join('×')}, frame render ${f.render.join('×')}, letterbox ${letterbox}`);
};

/** Pixels that differ inside the frame between two screenshots. */
const frameDiff = async (a: string, b: string, r: Rect) => {
  const [x, y] = await Promise.all([a, b].map(async (p) => decodePng(new Uint8Array(await Bun.file(p).arrayBuffer()))));
  if (x.width !== y.width || x.height !== y.height) return { px: -1, share: 1, max: 255 };
  const n = x.channels, s = x.width / (await tab.eval<number>('innerWidth'));
  const x0 = Math.ceil(r.x * s), x1 = Math.floor((r.x + r.w) * s), y0 = Math.ceil(r.y * s), y1 = Math.floor((r.y + r.h) * s);
  let px = 0, max = 0;
  for (let j = y0; j < y1; j++)
    for (let i = x0; i < x1; i++) {
      const k = (j * x.width + i) * n;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(x.data[k + c] - y.data[k + c]));
      if (d > 0) px++;
      max = Math.max(max, d);
    }
  return { px, share: px / Math.max(1, (x1 - x0) * (y1 - y0)), max };
};

/** Zoom in and out and drag, then put focal and aim back: every rebuild on the way reuses pooled buffers, and the picture must match. */
async function zoomDrag(tag: string, w: number, h: number, dpr: number) {
  await tab.viewport(w, h, dpr);
  await go(url(200, false, 'day'));
  if (!(await settle())) return check(`${tag} settles`, false, 'terrain never settled');
  await fillCheck(tag);
  const frame = await tab.eval<Rect>('window.__mp.frame()');
  const before = `${shots}/${tag}-before.png`;
  await tab.shot(before);
  const c0 = await tab.eval<{ az: number; el: number; f: number }>('(({ azimuthDeg: az, elevationDeg: el, focalMm: f }) => ({ az, el, f }))(window.__scape.prism.cam)');
  const base = await tab.eval<number>('window.__scape.composition.getState().focalMm');
  const m0 = await tab.eval<{ mesh: number; recycled: number }>('({ mesh: window.__mp.mesh, recycled: window.__mp.recycled })');
  const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  for (let i = 0; i < 30; i++) {
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: i < 15 ? -40 : 40 });
    await Bun.sleep(i === 14 ? 3000 : 60);
  }
  const mouse = (type: string, x: number, y: number) => tab.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
  await mouse('mousePressed', cx, cy);
  for (let i = 1; i <= 20; i++) {
    await mouse('mouseMoved', cx - (frame.w * 0.4 * i) / 20, cy + (frame.h * 0.1 * i) / 20);
    await Bun.sleep(30);
  }
  await mouse('mouseReleased', cx - frame.w * 0.4, cy + frame.h * 0.1);
  await settle();
  await tab.shot(`${shots}/${tag}-moved.png`);
  await tab.eval(`(() => { const c = window.__scape.composition.getState(); c.update({ focalMm: ${base} }); c.aim(${c0.az}, ${c0.el}); return true; })()`);
  const ok = await settle();
  const after = `${shots}/${tag}-after.png`;
  await tab.shot(after);
  const m1 = await tab.eval<{ mesh: number; recycled: number }>('({ mesh: window.__mp.mesh, recycled: window.__mp.recycled })');
  check(`${tag} zoom and drag rebuild through the pool`, ok && m1.mesh > m0.mesh && m1.recycled > m0.recycled, `${m1.mesh - m0.mesh} mesh answers, ${m1.recycled - m0.recycled} buffers handed back`);
  const d = await frameDiff(before, after, frame);
  check(`${tag} picture matches before and after`, d.px >= 0 && d.share < 0.001, d.px < 0 ? 'size differs' : `${d.px} px differ (${(d.share * 100).toFixed(3)} %), max Δ ${d.max}`);
}

await zoomDrag('desktop', 1400, 900, 2);
await zoomDrag('large', 3840, 2160, 2);
await zoomDrag('phone', 390, 844, 3);

// Every focal, orientation and light, changed in place so each rebuild reuses the last one's buffers.
await tab.viewport(1400, 900, 2);
await go(url(24, false, 'day'));
await settle();
for (const time of ['day', 'night'] as const)
  for (const portrait of [false, true])
    for (const f of FOCALS) {
      const tag = `${f}mm-${portrait ? 'portrait' : 'landscape'}-${time}`;
      await tab.eval(`(() => { const S = window.__scape; S.composition.getState().update({ focalMm: ${f}, orientation: '${portrait ? 'Portrait' : 'Landscape'}' }); S.world.getState().setTime(${Date.parse(TIMES[time])}); return true; })()`);
      const ok = await settle();
      await tab.shot(`${shots}/${tag}.png`);
      const cam = await tab.eval<{ f: number; w: number; h: number }>('(({ focalMm: f, frameWmm: w, frameHmm: h }) => ({ f, w, h }))(window.__scape.prism.cam)');
      check(`${tag} settles`, ok && Math.round(cam.f) === f && cam.w > cam.h !== portrait, `focal ${cam.f.toFixed(0)} mm, frame ${cam.w}×${cam.h} mm`);
      await fillCheck(tag);
    }

await tab.send('Emulation.clearDeviceMetricsOverride');
tab.close();
console.log('| check | result | detail |\n|---|---|---|');
console.log(rows.join('\n'));
process.exit(failed ? 1 : 0);
