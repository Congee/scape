// Sky marks stay on top: over the reference photo, the horizon line and the rainbow, on any build (no dev probes needed).
/* oxlint-disable no-await-in-loop -- smoke steps run one frame at a time */
// Usage: bun scripts/smoke/markstop.ts <cdp> <port> <shot-dir> [build label] [cell name regex]
import { Tab } from './cdp';

const [cdp = '9470', port = '5470', shots = '/tmp/markstop', label = 'this build', only = ''] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
// Exchange Place; the sun path's sunset point is aimed at, with terrain and buildings off.
const CAM = '40.7163,-74.0325';
const TGT = '40.7130,-74.0132';
const Light = { Day: 'day', Night: 'night' } as const;
type Light = (typeof Light)[keyof typeof Light];
// An equinox morning, when the bow's circle crosses the sun's own path above the horizon.
const TIMES: Record<Light, string> = { day: '2026-03-20T13:00Z', night: '2026-06-22T03:00Z' };
const Orient = { Landscape: 'L', Portrait: 'P' } as const;
type Orient = (typeof Orient)[keyof typeof Orient];
const DESKTOP = { w: 1280, h: 800, dpr: 2 };
const PHONE = { w: 390, h: 844, dpr: 3 };
type Rgb = [number, number, number];
const HORIZON = [230, 237, 243];
const SUN: Rgb = [0xf5, 0xa5, 0x24];
const PHOTO_GREY = 0x70;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

type Img = { w: number; h: number; at: (x: number, y: number) => Rgb };

/** A screenshot as pixels, via an uncompressed BMP from `sips`, so no decoder is needed. */
const load = async (png: string): Promise<Img> => {
  const bmp = png.replace(/\.png$/, '.bmp');
  const r = Bun.spawnSync(['sips', '-s', 'format', 'bmp', png, '--out', bmp]);
  if (r.exitCode !== 0) throw new Error(`sips failed on ${png}`);
  const b = await Bun.file(bmp).bytes();
  await Bun.file(bmp).delete();
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const off = v.getUint32(10, true), w = v.getInt32(18, true), hRaw = v.getInt32(22, true), step = v.getUint16(28, true) / 8;
  const h = Math.abs(hRaw), stride = (w * step + 3) & ~3;
  return {
    w,
    h,
    at: (x, y) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return [0, 0, 0];
      const o = off + (hRaw > 0 ? h - 1 - y : y) * stride + x * step;
      return [b[o + 2], b[o + 1], b[o]];
    }
  };
};
const maxc = (a: Rgb, b: readonly number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const diff = (a: Img, b: Img, x: number, y: number) => maxc(a.at(x, y), b.at(x, y));
const luma = (p: Rgb) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
const median = (xs: number[]) => (xs.length ? xs.toSorted((a, b) => a - b)[xs.length >> 1] : NaN);

const tab = await Tab.open(Number(cdp), BASE);
await tab.fresh(BASE);

const js = <T = unknown>(body: string, timeoutMs = 60_000) => tab.eval<T>(`(async () => { const S = window.__scape; ${body} })()`, timeoutMs);
/** Waits for an overlay frame drawn after now. */
const fresh = () => js(`const t = Date.now(); for (let i = 0; i < 100 && !(S.overlay?.at > t); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 400)); return true;`);
const MARKS_OFF = 'showPaths: false, showStars: false, showRainbow: false';
const show = async (patch: string) => {
  await js(`S.composition.getState().update({ ${patch} }); return true;`);
  await fresh();
};
const shot = async (path: string) => {
  await tab.shot(path);
  await tab.shot(path);
  return load(path);
};
/** Feeds a flat grey card the frame's shape to the photo input, fully opaque. */
const pickPhoto = async (path: string) => {
  const b64 = await js<string>(`
    const f = S.prism.cam.frame, w = 600, h = Math.round((600 * f.h) / f.w);
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = 'rgb(${PHOTO_GREY},${PHOTO_GREY},${PHOTO_GREY})'; g.fillRect(0, 0, w, h);
    const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = ''; for (const v of b) s += String.fromCharCode(v);
    return btoa(s);`);
  await Bun.write(path, Buffer.from(b64, 'base64'));
  await tab.send('DOM.enable');
  const r = (await tab.send('Runtime.evaluate', { expression: `document.querySelector('input[aria-label="Reference photo file"]')` })) as { result: { objectId?: string } };
  if (!r.result.objectId) throw new Error('no photo file input');
  await tab.send('DOM.setFileInputFiles', { files: [path], objectId: r.result.objectId });
  const shown = await tab.until<boolean>(`(() => { const p = window.__scape.photo, img = document.querySelector('.vf-photo img'); return p?.box?.w > 0 && (img ? img.complete && img.naturalWidth > 0 : !!p.nat); })()`, 10_000, 100);
  await js(`const imp = (path) => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === path) ?? path);
    (await imp('/src/lib/state/photo.ts')).photoStore.getState().update({ opacity: 1 }); return true;`);
  await fresh();
  return !!shown;
};

/** Sets the scene (marks off, no geometry) and finds where the sun path sets and where it crosses the primary bow. */
const setup = () =>
  js<{ setAz: number; bow: { az: number; alt: number } | null }>(`
  S.settings.getState().update({ terrain: false });
  S.composition.getState().update({ ${MARKS_OFF}, showBuildings: false, showStarNames: false, showConstellations: false, showTrails: false, showMilkyWay: false, showMoon: false, showMarkers: false, showRadiants: false, showGrid: false });
  const c = S.dayData.getState().curve, alt = c.altitude.Sun, az = c.azimuth.Sun;
  const wrap = (d) => ((d + 540) % 360) - 180, rad = Math.PI / 180;
  let setAz = NaN;
  for (let i = 1; i < c.n; i++) if (alt[i - 1] >= 0 && alt[i] < 0) setAz = az[i - 1] + (alt[i - 1] / (alt[i - 1] - alt[i])) * wrap(az[i] - az[i - 1]);
  const imp = (path) => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === path) ?? path);
  const [pos, bodies, rb] = await Promise.all(['core/astro/positions', 'core/astro/bodies', 'core/astro/rainbow'].map((m) => imp('/src/lib/' + m + '.ts')));
  const w = S.world.getState(), obs = bodies.makeObserver(w.pin, w.pinHeightM), sun = pos.position('Sun', new Date(w.time), obs);
  const sep = (a1, h1, a2, h2) => Math.acos(Math.min(1, Math.sin(h1 * rad) * Math.sin(h2 * rad) + Math.cos(h1 * rad) * Math.cos(h2 * rad) * Math.cos((a1 - a2) * rad))) / rad;
  const f = (i) => sep(sun.azimuth + 180, -sun.altitude, az[i], alt[i]) - rb.PRIMARY_DEG;
  let bow = null;
  for (let i = 1; i < c.n && !bow; i++) if (alt[i] > 3 && alt[i - 1] > 3 && Math.sign(f(i)) !== Math.sign(f(i - 1))) {
    // On the drawn chord between samples, not the true path: a long lens sees the sag.
    const k = f(i - 1) / (f(i - 1) - f(i));
    bow = { az: az[i - 1] + k * wrap(az[i] - az[i - 1]), alt: alt[i - 1] + k * (alt[i] - alt[i - 1]) };
  }
  return { setAz, bow };`);

/** The sun path's colour where it crosses the horizon row: a line drawn over it tints the path toward the line's colour. */
const horizonThrough = (on: Img, off: Img, dpr: number, f: { x: number; y: number; w: number; h: number }, ox: number, oy: number, ex: number) => {
  const fy = (oy + f.y + f.h / 2) * dpr;
  const x0 = (ox + f.x) * dpr, x1 = (ox + f.x + f.w) * dpr;
  const dash = (x: number, y: number) => luma(off.at(x, y)) - (luma(off.at(x, y - 4)) + luma(off.at(x, y + 4))) / 2;
  let yh = Math.round(fy), best = -1;
  for (let y = Math.round(fy) - 6; y <= Math.round(fy) + 6; y++) {
    let n = 0;
    for (let x = x0 + 8; x < x1 - 8; x += 2) n += dash(x, y) > 4 ? 1 : 0;
    if (n > best) [best, yh] = [n, y];
  }
  const core = (y: number) => {
    let d = Infinity, at = ex;
    for (let x = ex - 60 * dpr; x <= ex + 60 * dpr; x++) {
      const v = maxc(on.at(x, y), SUN);
      if (v < d) [d, at] = [v, x];
    }
    return { d, at };
  };
  const near = [-6, -5, 5, 6].map((d) => core(yh + d));
  if (near.some((c) => c.d > 40)) return { found: false, why: `no sun path near x ${Math.round(ex)}` } as const;
  const xp = near.reduce((s, c) => s + c.at, 0) / near.length;
  let gap = true;
  for (let x = xp - 2; x <= xp + 2; x++) gap &&= dash(x, yh) <= 4;
  if (gap) return { found: false, why: `crossing at x ${Math.round(xp)} in a dash gap` } as const;
  const base = Math.max(...near.map((c) => c.d));
  const through = core(yh).d - base;
  // What the line's 0.35 alpha would add if it sat on the path.
  const under = 0.35 * maxc(SUN, HORIZON);
  return { found: true, ratio: through / under, through, under } as const;
};

/** Path pixels inside the rainbow: how much of the rainbow's own change still lands on them. */
const rainbowThrough = (both: Img, marks: Img, bow: Img, none: Img, box: { x0: number; y0: number; x1: number; y1: number }) => {
  const ratios: number[] = [];
  let path = 0;
  for (let y = box.y0; y < box.y1; y++)
    for (let x = box.x0; x < box.x1; x++) {
      if (diff(marks, none, x, y) < 90) continue;
      path++;
      const b = diff(bow, none, x, y);
      if (b < 30) continue;
      ratios.push(diff(both, marks, x, y) / b);
    }
  return { n: ratios.length, median: median(ratios), path };
};

/** Mark pixels, and their colour, with the opaque photo in front of the picture. */
const overPhoto = (on: Img, off: Img, pOn: Img, pOff: Img, box: { x0: number; y0: number; x1: number; y1: number }) => {
  let n0 = 0, n1 = 0;
  const drift: number[] = [];
  for (let y = box.y0; y < box.y1; y++)
    for (let x = box.x0; x < box.x1; x++) {
      const d = diff(on, off, x, y);
      n0 += d > 40 ? 1 : 0;
      n1 += diff(pOn, pOff, x, y) > 40 ? 1 : 0;
      if (d > 90) drift.push(maxc(pOn.at(x, y), on.at(x, y)));
    }
  return { n0, n1, drift: median(drift) };
};

const cell = async (focal: number, orient: Orient, light: Light, prefix = '') => {
  const name = `${prefix}${light}-${focal}-${orient}`;
  if (only && !new RegExp(only).test(name)) return;
  await tab.navigate(`${BASE}/viewfinder?camera=${CAM}&target=${TGT}&t=${TIMES[light]}&f=${focal}${orient === Orient.Portrait ? '&o=p' : ''}`);
  // A curve for the default day can land before the URL's time does.
  const today = `(() => { const S = window.__scape, d = S?.dayData.getState(), t = S?.world.getState().time; return !!S?.prism?.cam && !!d.curve && !d.loading && d.dayStart <= t && t < d.dayEnd; })()`;
  const ready = (await tab.until(today, 60_000, 250)) && (await Bun.sleep(1000), await tab.until(today, 30_000, 250));
  if (!ready) return check(`${name}: loads`, false, 'no frame or day curve');
  const { setAz, bow } = await setup();
  await fresh();
  type Geo = { f: { x: number; y: number; w: number; h: number }; ox: number; oy: number; dpr: number };
  const measure = () => js<Geo>(`const r = document.querySelector('canvas.vf').getBoundingClientRect(), c = S.prism.cam; return { f: c.frame, ox: r.left, oy: r.top, dpr: devicePixelRatio };`);
  let { f, ox, oy, dpr } = await measure();
  const marks = `showPaths: true${light === Light.Night ? ', showStars: true' : ''}`;
  const p = (s: string) => `${shots}/${name}-${s}.png`;

  // The crossing sits a quarter frame off centre, clear of the reticle, nudged until it lands on a dash.
  let hz: ReturnType<typeof horizonThrough> | null = null;
  let on: Img | null = null;
  let off: Img | null = null;
  const pxPerDeg = await js<number>(`const c = S.prism.cam; return (c.frame.pxPerMm * c.focalMm * Math.PI) / 180;`);
  for (const nudge of Array.from({ length: 10 }, (_, n) => n + f.w / 4)) {
    await js(`S.composition.getState().aim(${setAz} - ${nudge / pxPerDeg}, 0); return true;`);
    await show(MARKS_OFF);
    // The phone's frame settles its height after the first aim.
    ({ f, ox, oy, dpr } = await measure());
    off = await shot(p('none'));
    await show(marks);
    on = await shot(p('marks'));
    hz = horizonThrough(on, off, dpr, f, ox, oy, (ox + f.x + f.w / 2 + nudge) * dpr);
    if (hz.found) break;
  }
  const box = { x0: Math.ceil((ox + f.x) * dpr) + 6, y0: Math.ceil((oy + f.y) * dpr) + 6, x1: Math.floor((ox + f.x + f.w) * dpr) - 6, y1: Math.floor((oy + f.y + f.h) * dpr) - 6 };
  if (hz?.found) check(`${name}: path over the horizon line`, hz.ratio < 0.5, `horizon shows through ${hz.through.toFixed(0)} of ${hz.under.toFixed(0)} if under (${(hz.ratio * 100).toFixed(0)} %)`);
  else check(`${name}: path over the horizon line`, false, `no crossing on a dash: ${hz?.why}`);

  if (light === Light.Day && bow) {
    await js(`S.composition.getState().aim(${bow.az} - ${f.w / 4 / pxPerDeg}, ${bow.alt}); return true;`);
    await show(MARKS_OFF);
    off = await shot(p('bow-none'));
    await show(marks);
    on = await shot(p('bow-marks'));
    await show(`${MARKS_OFF}, showRainbow: true`);
    const bowImg = await shot(p('bow'));
    await show(`${marks}, showRainbow: true`);
    const both = await shot(p('both'));
    await show('showRainbow: false');
    await js(`S.composition.getState().aim(${setAz} - ${f.w / 4 / pxPerDeg}, 0); return true;`);
    const rb = rainbowThrough(both, on!, bowImg, off!, box);
    // A long lens can see a path chord with both ends far outside, which the path never draws.
    if (rb.path === 0) rows.push(`| ${name}: path over the rainbow | n/a | no path drawn in frame (chord ends culled) |`);
    else check(`${name}: path over the rainbow`, rb.n >= 5 && rb.median < 0.45, `${rb.n} path pixels in the bow keep ${(rb.median * 100).toFixed(0)} % of its change (crossing at ${bow.az.toFixed(1)}°, ${bow.alt.toFixed(1)}°)`);
  } else if (light === Light.Day) check(`${name}: path over the rainbow`, false, 'the sun path never meets the bow');

  await show(MARKS_OFF);
  off = await shot(p('none'));
  await show(marks);
  on = await shot(p('marks'));
  const picked = await pickPhoto(`${shots}/${name}-card.png`);
  const pOn = await shot(p('photo-marks'));
  await show(MARKS_OFF);
  const pOff = await shot(p('photo-none'));
  await show(marks);
  const ph = overPhoto(on!, off!, pOn, pOff, box);
  check(`${name}: marks over the photo, in their colour`, picked && ph.n0 > 0 && ph.n1 >= 0.6 * ph.n0 && ph.drift < 30, `${ph.n1} of ${ph.n0} mark pixels show over it; core colour off by ${ph.drift}`);

  if (light === Light.Day) {
    // A fixed time and no rainbow: nothing moves, so the photo must not keep the loop awake.
    // Building tiles stream in on a cold page, even hidden, and each one is a real redraw.
    await tab.until('!window.__scape.buildings.getState().busy', 90_000, 500);
    await Bun.sleep(1000);
    if (await js<boolean>('S.idle.reset(); return true;').catch(() => false)) {
      await Bun.sleep(3000);
      const frames = await js<number>('return S.idle.glFrames;');
      check(`${name}: idle with a photo`, frames === 0, `${frames} GL frames in 3 s`);
    } else rows.push(`| ${name}: idle with a photo | n/a | no idle probe on this build |`);
  }
};

console.error(`markstop smoke against ${label} on ${BASE}`);
await tab.viewport(DESKTOP.w, DESKTOP.h, DESKTOP.dpr);
for (const focal of [24, 200, 600, 2400]) for (const orient of [Orient.Landscape, Orient.Portrait]) for (const light of [Light.Day, Light.Night]) await cell(focal, orient, light);
await tab.viewport(PHONE.w, PHONE.h, PHONE.dpr);
await cell(24, Orient.Portrait, Light.Night, 'phone-');
await cell(200, Orient.Portrait, Light.Day, 'phone-');
const wide = await tab.eval<boolean>('document.documentElement.scrollWidth > window.innerWidth');
check('phone 390×844: no sideways scroll', !wide, wide ? 'overflows' : 'fits');
await tab.viewport(DESKTOP.w, DESKTOP.h, DESKTOP.dpr);
tab.close();

console.log(`\n${label}\n\n| Check | Result | Detail |\n|---|---|---|\n${rows.join('\n')}`);
process.exit(failed ? 1 : 0);
