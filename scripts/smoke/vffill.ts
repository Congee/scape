// Viewfinder fill smoke: the picture fills the area, the sensor frame is bordered only where it doesn't, marks show beyond it.
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
// Usage: bun scripts/smoke/vffill.ts <cdp> <port> [shot-dir] [reference-shot-dir] [only-tag-substring]
// With a reference dir (the same scenes shot on master), the pixels inside the frame must match it.
import { existsSync, mkdirSync } from 'node:fs';
import { decodePng } from '../../src/lib/core/terrain/png';
import { Tab } from './cdp';

const [cdp = '9750', port = '5750', shots = `${process.env.TMPDIR ?? '/tmp'}/vffill`, ref = '', only = ''] = process.argv.slice(2);
const want = (tag: string) => tag.includes(only);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });
// De Rotterdam from the Maas: terrain plus 3DBAG buildings in the frame.
const CAMERA = '51.9091,4.4868';
const TARGET = '51.90664,4.48805';
const TIMES = { day: '2026-06-21T13:00Z', night: '2026-06-21T23:00Z', evening: '2026-06-21T16:30Z' } as const;
const FOCALS = [24, 200, 600, 2400];
const BORDER = [230, 237, 243];

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const HELPERS = `(() => {
  if (window.__vf) return true;
  const S = window.__scape;
  const settled = () => {
    const t = S.terrain.getState(), p = S.prism;
    return !t.busy.Mesh && !t.busy.View && t.mesh.length > 0 && t.mesh.length === t.mesh[0].levels && !!p?.terrain && p.terrain.levels === t.mesh.length && !S.buildings.getState().busy && !p.lod2?.busy;
  };
  // Page CSS px; area falls back to the frame where the build has none.
  const rects = () => {
    const r = document.querySelector('canvas.vf').getBoundingClientRect(), c = S.prism.cam, f = c.frame, a = c.area ?? f;
    const at = (q) => ({ x: r.left + q.x, y: r.top + q.y, w: q.w, h: q.h });
    return { frame: at(f), area: at(a), dpr: devicePixelRatio, render: [S.prism.rw, S.prism.rh], shadow: S.prism.shadow };
  };
  window.__vf = { settled, rects };
  return true;
})()`;

const tab = await Tab.open(Number(cdp), BASE);
// A service worker left by a production build on this port would serve that build instead of the dev server.
await tab.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'service_workers,cache_storage' });
await tab.fresh(BASE);

const js = <T = unknown>(body: string, timeoutMs = 60_000) => tab.eval<T>(`(async () => { const S = window.__scape; ${body} })()`, timeoutMs);
const go = async (url: string) => {
  await tab.eval("try { localStorage.removeItem('scape.composition') } catch {}");
  await tab.navigate(url);
  await tab.until('!!(window.__scape && document.querySelector("canvas.vf"))', 30_000, 250);
  await tab.eval(HELPERS);
  await tab.eval('window.__scape.ui.setState({ panelCollapsed: true })');
};
const settle = async () => {
  const ok = await tab.until('!!window.__scape.prism && window.__vf.settled()', 90_000, 250);
  await Bun.sleep(1500);
  return !!ok && (await tab.eval<boolean>('window.__vf.settled()'));
};
const url = (f: number, portrait: boolean, time: keyof typeof TIMES) => `${BASE}/viewfinder?camera=${CAMERA}&target=${TARGET}&t=${TIMES[time]}&f=${f}${portrait ? '&o=p' : ''}`;

type Rect = { x: number; y: number; w: number; h: number };
type Rects = { frame: Rect; area: Rect; dpr: number; render: number[] };
type Img = Awaited<ReturnType<typeof decodePng>>;
const load = async (p: string) => decodePng(new Uint8Array(await Bun.file(p).arrayBuffer()));
const px = (img: Img, i: number, j: number) => {
  const k = (j * img.width + i) * img.channels;
  return [img.data[k], img.data[k + 1], img.data[k + 2]];
};
const near = (a: number[], b: number[], tol: number) => a.every((v, c) => Math.abs(v - b[c]) <= tol);
/** Device-px box of a CSS rect, shrunk by `inset` device px. */
const box = (r: Rect, s: number, inset = 0) => ({ x0: Math.ceil(r.x * s) + inset, y0: Math.ceil(r.y * s) + inset, x1: Math.floor((r.x + r.w) * s) - inset, y1: Math.floor((r.y + r.h) * s) - inset });

const span = (a: number, z: number) => Array.from({ length: Math.max(0, z - a) }, (_, k) => a + k);
/** Share of border-coloured pixels in the band just outside each frame edge; the band covers the frame's snap to device px. */
const borderShare = (img: Img, r: Rect, s: number) => {
  const b = box(r, s);
  const reach = Math.ceil(2 * s) + 1;
  const hit = (i: number, j: number, di: number, dj: number) => span(0, reach).some((k) => near(px(img, i + di * k, j + dj * k), BORDER, 8));
  const line = (pts: [number, number][], di: number, dj: number) => pts.filter(([i, j]) => hit(i, j, di, dj)).length / Math.max(1, pts.length);
  const ys = span(b.y0 + 4, b.y1 - 4), xs = span(b.x0 + 4, b.x1 - 4);
  return {
    left: line(ys.map((j) => [b.x0, j]), -1, 0),
    right: line(ys.map((j) => [b.x1 - 1, j]), 1, 0),
    top: line(xs.map((i) => [i, b.y0]), 0, -1),
    bottom: line(xs.map((i) => [i, b.y1 - 1]), 0, 1)
  };
};

/** Pixels that differ inside the frame, away from its edge where master drew the old outline. */
const frameDiff = (a: Img, b: Img, r: Rect, s: number) => {
  if (a.width !== b.width || a.height !== b.height) return { px: -1, share: 1, max: 255 };
  const q = box(r, s, Math.ceil(2 * s));
  let n = 0, max = 0;
  for (let j = q.y0; j < q.y1; j++)
    for (let i = q.x0; i < q.x1; i++) {
      const x = px(a, i, j), y = px(b, i, j);
      const d = Math.max(...x.map((v, c) => Math.abs(v - y[c])));
      if (d > 0) n++;
      max = Math.max(max, d);
    }
  return { px: n, share: n / Math.max(1, (q.x1 - q.x0) * (q.y1 - q.y0)), max };
};

/** Mean brightness of the extension beyond the frame, or -1 when the frame fills the area. */
const extensionMean = (img: Img, r: Rects, s: number) => {
  const f = box(r.frame, s, -Math.ceil(2 * s)), a = box(r.area, s, Math.ceil(s));
  let sum = 0, n = 0;
  for (let j = a.y0; j < a.y1; j += 3)
    for (let i = a.x0; i < a.x1; i += 3) {
      if (i >= f.x0 && i < f.x1 && j >= f.y0 && j < f.y1) continue;
      const p = px(img, i, j);
      sum += (p[0] + p[1] + p[2]) / 3;
      n++;
    }
  return n ? sum / n : -1;
};

async function scene(tag: string, w: number, h: number, dpr: number, f: number, portrait: boolean, time: keyof typeof TIMES) {
  if (!want(tag)) return;
  await tab.viewport(w, h, dpr);
  await go(url(f, portrait, time));
  const ok = await settle();
  return inspect(tag, ok, time);
}

async function inspect(tag: string, ok: boolean, time: keyof typeof TIMES) {
  const r = await tab.eval<Rects>('window.__vf.rects()');
  const path = `${shots}/${tag}.png`;
  await tab.shot(path);
  await Bun.write(`${shots}/${tag}.json`, JSON.stringify(r));
  const img = await load(path);
  const s = img.width / (await tab.eval<number>('innerWidth'));
  const slackX = r.area.w - r.frame.w > 1, slackY = r.area.h - r.frame.h > 1;
  const dev = [Math.round(r.area.w * s), Math.round(r.area.h * s)];
  check(`${tag} settles and renders the whole area`, ok && Math.abs(r.render[0] - dev[0]) <= 2 && Math.abs(r.render[1] - dev[1]) <= 2, `frame ${r.frame.w.toFixed(0)}×${r.frame.h.toFixed(0)} in area ${r.area.w.toFixed(0)}×${r.area.h.toFixed(0)} css px, render ${r.render.join('×')} @${r.dpr}`);
  const b = borderShare(img, r.frame, s);
  const sides = { left: slackX, right: slackX, top: slackY, bottom: slackY };
  const bad = (Object.keys(sides) as (keyof typeof sides)[]).filter((k) => (sides[k] ? b[k] < 0.9 : b[k] > 0.8));
  check(`${tag} border only where the frame leaves room`, bad.length === 0, `${(Object.keys(b) as (keyof typeof b)[]).map((k) => `${k} ${(b[k] * 100).toFixed(0)} %${sides[k] ? '' : ' (none wanted)'}`).join(', ')}`);
  if (time !== 'night' && (slackX || slackY)) {
    const m = extensionMean(img, r, s);
    check(`${tag} picture drawn beyond the frame`, m > 20, `mean brightness ${m.toFixed(0)} outside the frame`);
  }
  const refPath = `${ref}/${tag}.png`;
  if (ref && existsSync(refPath)) {
    const d = frameDiff(await load(refPath), img, r.frame, s);
    check(`${tag} in-frame pixels match master`, d.px === 0, d.px < 0 ? 'size differs' : `${d.px} px differ (${(d.share * 100).toFixed(4)} %), max Δ ${d.max}`);
  }
}

// Every focal × orientation × light on the desktop window.
for (const time of ['day', 'night'] as const)
  for (const portrait of [false, true]) for (const f of FOCALS) await scene(`desktop-${f}mm-${portrait ? 'portrait' : 'landscape'}-${time}`, 1440, 900, 2, f, portrait, time);
await scene('large-24mm-landscape-day', 3840, 2160, 2, 24, false, 'day');
await scene('large-200mm-portrait-night', 3840, 2160, 2, 200, true, 'night');
await scene('phone-24mm-portrait-day', 390, 844, 3, 24, true, 'day');
await scene('phone-200mm-landscape-night', 390, 844, 3, 200, false, 'night');

// A photo overlay stays aligned to the frame.
if (want('desktop-200mm-portrait-day-photo')) {
  await tab.viewport(1440, 900, 2);
  await go(url(200, true, 'day'));
  const ok = await settle();
  const card = `${shots}/photo-card.png`;
  const b64 = await js<string>(`
    const f = S.prism.cam.frame, w = 600, h = Math.round((600 * f.h) / f.w);
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    for (let j = 0; j < h; j += 50) for (let i = 0; i < w; i += 50) { g.fillStyle = (i + j) % 100 ? '#c04040' : '#4040c0'; g.fillRect(i, j, 50, 50); }
    const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = ''; for (const v of b) s += String.fromCharCode(v);
    return btoa(s);`);
  await Bun.write(card, Buffer.from(b64, 'base64'));
  await tab.send('DOM.enable');
  const input = (await tab.send('Runtime.evaluate', { expression: `document.querySelector('input[aria-label="Reference photo file"]')` })) as { result: { objectId?: string } };
  if (input.result.objectId) await tab.send('DOM.setFileInputFiles', { files: [card], objectId: input.result.objectId });
  const shown = !!(await tab.until<boolean>('window.__scape.photo?.box?.w > 0 && !!window.__scape.photo.nat', 10_000, 100));
  await Bun.sleep(1000);
  const p = await tab.eval<{ box: { cx: number; cy: number; w: number; h: number }; frame: Rect } | null>('window.__scape.photo && { box: window.__scape.photo.box, frame: window.__scape.photo.frame }');
  const aligned = !!p && Math.abs(p.box.cx - (p.frame.x + p.frame.w / 2)) < 0.5 && Math.abs(p.box.cy - (p.frame.y + p.frame.h / 2)) < 0.5;
  check('desktop-200mm-portrait-day-photo overlay centred on the frame', shown && aligned, p ? `photo centre ${p.box.cx.toFixed(1)},${p.box.cy.toFixed(1)} ${p.box.w.toFixed(0)}×${p.box.h.toFixed(0)}, frame centre ${(p.frame.x + p.frame.w / 2).toFixed(1)},${(p.frame.y + p.frame.h / 2).toFixed(1)}` : 'no photo');
  await inspect('desktop-200mm-portrait-day-photo', ok, 'day');
}

// The low sun just beyond the frame's side edge is drawn in the extended view.
if (want('desktop-200mm-portrait-evening-sun-beyond-frame')) {
  await tab.viewport(1440, 900, 2);
  await go(url(200, true, 'evening'));
  await settle();
  const aimed = await js<{ az: number; alt: number } | null>(`
    const c = S.prism.cam, sun = { az: c.sunAz, alt: c.sunAlt }, f = c.frame, a = c.area ?? f, ppd = f.w / (2 * Math.atan(c.frameWmm / 2 / c.focalMm) * 180 / Math.PI);
    const off = (f.w / 2 + Math.max(10, (a.w - f.w) / 4)) / ppd / Math.cos(sun.alt * Math.PI / 180);
    S.composition.getState().aim(sun.az - off, sun.alt);
    return { az: sun.az, alt: sun.alt };`);
  await settle();
  const r = await tab.eval<Rects>('window.__vf.rects()');
  const sun = await tab.eval<{ x: number; y: number; hidden: boolean } | null>('window.__scape.overlay?.bodies?.Sun ?? null');
  const cv = await tab.eval<{ x: number; y: number }>("(() => { const r = document.querySelector('canvas.vf').getBoundingClientRect(); return { x: r.left, y: r.top }; })()");
  const sx = sun ? sun.x + cv.x : NaN;
  const out = !!sun && !sun.hidden && sx > r.frame.x + r.frame.w && sx < r.area.x + r.area.w;
  await tab.shot(`${shots}/desktop-200mm-portrait-evening-sun-beyond-frame.png`);
  check('sun beyond the frame shows in the extended view', !!aimed && out, sun ? `sun at x ${sx.toFixed(0)}, frame right ${(r.frame.x + r.frame.w).toFixed(0)}, area right ${(r.area.x + r.area.w).toFixed(0)}${sun.hidden ? ', hidden' : ''}` : 'no sun');
}

await tab.send('Emulation.clearDeviceMetricsOverride');
tab.close();
console.log('| check | result | detail |\n|---|---|---|');
console.log(rows.join('\n'));
process.exit(failed ? 1 : 0);
