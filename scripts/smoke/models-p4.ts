// Precise models P4 smoke: a model hides the sun, the moon and markers; the reference photo loads, fades, nudges and fits the lens.
/* oxlint-disable no-await-in-loop -- smoke steps run one frame at a time */
// Usage: bun scripts/smoke/models-p4.ts <cdp> <dev-port> <preview-port|-> <shot-dir>
import { Tab } from './cdp';

const [cdp = '9354', port = '5350', , shots = '/tmp/models-p4'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const TOWER_NAME = '30 Hudson Yards (P4 smoke)';
const MARKER_NAME = 'Behind 30 Hudson Yards (P4 smoke)';
const TOWER = { lat: 40.754, lng: -74.0008 };
const HOBOKEN = '40.7527,-74.0225';
// From the app's astro code, seen from Hoboken: each body stands at the tower's bearing (85.5°), below its crown.
const Light = { Day: 'day', Night: 'night' } as const;
type Light = (typeof Light)[keyof typeof Light];
const TIMES: Record<Light, string> = { day: '2027-08-29T11:12Z', night: '2026-12-28T03:04Z' };
const BODY: Record<Light, string> = { day: 'Sun', night: 'Moon' };
// The moon at 13.3°, above the Overture tower's crown but below a model scaled 1.5×.
const HIGH_MOON = '2027-01-24T01:05Z';
const PHOTO_FOCAL35 = 200;
const PHONE = { w: 390, h: 844 };
const DESKTOP = { w: 1280, h: 800 };
const FULL_FRAME_DIAG_MM = Math.hypot(36, 24);

type Box = { x: number; y: number; width: number; height: number };
type Disc = { az: number; alt: number; x: number; y: number; r: number; hidden: boolean };
type Fit = { box: { cx: number; cy: number; w: number; h: number; rotDeg: number }; frame: { x: number; y: number; w: number; h: number }; pxPerMm: number; focalMm: number; focal35: number | null; nat: { w: number; h: number }; img: { cx: number; cy: number; w: number; h: number }; opacity: string; vf: { x: number; y: number } };

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
await tab.activate();

// Page-side helpers, re-installed after every load.
const HELPERS = `(async () => {
  if (window.__smoke) return true;
  // The URL the app loaded, which after HMR carries a ?t= stamp; a bare import would make a second store.
  const imp = (path) => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === path) ?? path);
  const [buildings, seed, geo, positions, bodies] = await Promise.all(['state/buildings', 'core/model/seed', 'core/geo/geodesy', 'core/astro/positions', 'core/astro/bodies'].map((m) => imp('/src/lib/' + m + '.ts')));
  const S = window.__scape;
  const named = (name) => S.models.getState().models.find((m) => m.name === name) ?? null;
  const frame = () => {
    const r = document.querySelector('.vf-gl').getBoundingClientRect(), f = S.prism.cam.frame;
    return { x: r.left + f.x, y: r.top + f.y, width: f.w, height: f.h };
  };
  const sky = (body) => { const w = S.world.getState(); return positions.position(body, new Date(w.time), bodies.makeObserver(w.pin, w.pinHeightM)); };
  /** Waits for an overlay frame drawn after now. */
  const fresh = async () => { const t = Date.now(); for (let i = 0; i < 100 && !(S.overlay?.at > t); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 300)); return S.overlay; };
  /** The disc in page px, from the overlay's canvas px. */
  const disc = (body) => { const d = S.overlay?.bodies?.[body], r = document.querySelector('canvas.vf').getBoundingClientRect(); return d ? { ...d, x: r.left + d.x, y: r.top + d.y } : null; };
  const decode = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => { const c = new OffscreenCanvas(i.width, i.height).getContext('2d'); c.drawImage(i, 0, 0); res({ d: c.getImageData(0, 0, i.width, i.height).data, w: i.width, h: i.height }); }; i.src = 'data:image/png;base64,' + b64; });
  /** Brightest and mean luminance of a screenshot. */
  const luma = async (b64) => { const { d } = await decode(b64); let max = 0, sum = 0; for (let k = 0; k < d.length; k += 4) { const l = 0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2]; max = Math.max(max, l); sum += l; } return { max: Math.round(max), mean: Math.round(sum / (d.length / 4)) }; };
  /** Brightest pixel inside a disc crop against the sky or wall either side of it; the crop is 2.4 radii wide. */
  const contrast = async (b64) => {
    const { d, w, h } = await decode(b64);
    const L = (x, y) => { const k = (y * w + x) * 4; return 0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2]; };
    const R = (w / 2.4) * 0.9;
    let disc = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - w / 2, y - h / 2) < R) disc = Math.max(disc, L(x, y));
    let bg = 0, n = 0;
    for (const cx of [2, w - 3]) for (let y = Math.floor(h / 2) - 2; y <= h / 2 + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { bg += L(x, y); n++; }
    bg /= n;
    return { disc: Math.round(disc), bg: Math.round(bg), contrast: Math.round(disc - bg) };
  };
  /** A test card for the photo overlay, as JPEG bytes in base64. */
  const card = async (w, h) => {
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = '#f0e8d0'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c03020'; g.lineWidth = 6;
    for (let x = 0; x <= w; x += w / 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += h / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
    let s = ''; for (const v of b) s += String.fromCharCode(v);
    return btoa(s);
  };
  /** Where the controller put the photo, and where the img really is. */
  const fit = () => {
    const p = S.photo, img = document.querySelector('.vf-photo img'), vf = document.querySelector('canvas.vf').getBoundingClientRect();
    if (!p || !img) return null;
    const r = img.getBoundingClientRect();
    return { box: p.box, frame: p.frame, pxPerMm: S.prism.cam.frame.pxPerMm, focalMm: p.focalMm, focal35: p.focal35, nat: { w: img.naturalWidth, h: img.naturalHeight }, img: { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }, opacity: img.style.opacity, vf: { x: vf.left, y: vf.top } };
  };
  window.__smoke = { buildings, seed, geo, named, frame, sky, fresh, disc, luma, contrast, card, fit };
  return true;
})()`;

const js = <T = unknown>(body: string, timeoutMs = 60_000) =>
  tab.eval<T>(`(async () => { await ${HELPERS}; const { buildings, seed, geo, named, frame, sky, fresh, disc, luma, contrast, card, fit } = window.__smoke; const S = window.__scape; ${body} })()`, timeoutMs);
const settle = (ms = 1500) => Bun.sleep(ms);
const click = (label: string) => tab.eval<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`);
/** Waits for a frame drawn with the wanted focal and orientation, then for tiles to land. */
const drawn = async (focal: number, orient: string) => {
  const ok = await tab.until(`(() => { const p = window.__scape?.prism; return p && p.cam && Math.abs(p.cam.focalMm - ${focal}) < 1e-6 && (p.cam.frameWmm > p.cam.frameHmm) === ${orient === 'Landscape'} && p.terrain; })()`, 60_000, 300);
  if (!ok) throw new Error(`no ${focal} mm ${orient} frame within 60 s`);
  await tab.until(`!window.__scape.buildings.getState().busy`, 30_000, 300);
  await settle();
};
const viewfinder = async (t: string, f: number) => {
  await tab.navigate(`${BASE}/viewfinder?camera=${HOBOKEN}&target=${TOWER.lat},${TOWER.lng}&f=${f}&t=${t}`);
  await tab.until('!!window.__scape?.prism?.cam && window.__scape.models.getState().loaded', 60_000);
  await js("S.world.getState().setPinHeight(0); S.composition.getState().update({ showPaths: false }); return true;");
};
/** Frames the body at a focal and orientation; returns its overlay disc once drawn. */
const frameBody = async (body: string, f: number, orient: string, dAlt = 0) => {
  await js(`S.composition.getState().update({ focalMm: ${f}, orientation: '${orient}' }); const p = sky('${body}'); S.composition.getState().aim(p.azimuth, p.altitude + ${dAlt}); return true;`);
  await drawn(f, orient);
  return js<Disc | null>(`await fresh(); return disc('${body}');`);
};
const discShot = async (name: string, d: Disc | null) => {
  if (!d) return null;
  const s = Math.max(12, d.r * 2.4);
  const b64 = await tab.shot(`${shots}/${name}.png`, { x: d.x - s / 2, y: d.y - s / 2, width: s, height: s });
  return js<{ disc: number; bg: number; contrast: number }>(`return contrast(${JSON.stringify(b64)});`);
};
/** Disc shots aim below the body, so the centre mark stays off it. */
const BELOW = -0.6;
const patchModel = (patch: string) => js(`await S.models.getState().update(named(${JSON.stringify(TOWER_NAME)}).id, ${patch}); return true;`);
const setBuildings = (on: boolean) => js(`S.composition.getState().update({ showBuildings: ${on} }); return true;`);
/** Overlay state for a body after the scene changed. */
const bodyNow = (body: string) => js<Disc | null>(`await fresh(); return disc('${body}');`);

/** An Exif APP1 carrying FocalLengthIn35mmFilm, spliced in after SOI. */
function withFocal35(jpeg: Uint8Array, focal35: number): Uint8Array {
  const tiff = new Uint8Array(44);
  const v = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  v.setUint32(4, 8, true);
  v.setUint16(8, 1, true);
  v.setUint16(10, 0x8769, true);
  v.setUint16(12, 4, true);
  v.setUint32(14, 1, true);
  v.setUint32(18, 26, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 0xa405, true);
  v.setUint16(30, 3, true);
  v.setUint32(32, 1, true);
  v.setUint16(36, focal35, true);
  const app1 = new Uint8Array(4 + 6 + tiff.length);
  app1.set([0xff, 0xe1, (app1.length - 2) >> 8, (app1.length - 2) & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  app1.set(tiff, 10);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2));
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}
/** Feeds a file to the hidden photo input, as a picked file would arrive. */
const pickPhoto = async (path: string) => {
  await tab.send('DOM.enable');
  const r = (await tab.send('Runtime.evaluate', { expression: `document.querySelector('input[aria-label="Reference photo file"]')` })) as { result: { objectId?: string } };
  if (!r.result.objectId) throw new Error('no photo file input');
  await tab.send('DOM.setFileInputFiles', { files: [path], objectId: r.result.objectId });
  return tab.until<boolean>(`window.__scape.photo?.box?.w > 0 && document.querySelector('.vf-photo img')?.complete`, 10_000, 100);
};
/** The photo's expected box from its Exif lens, worked here rather than by fit.ts. */
const fitError = (p: Fit, focal35: number | null) => {
  const aspect = p.nat.h / p.nat.w;
  const w = focal35 ? (2 * ((FULL_FRAME_DIAG_MM * p.nat.w) / Math.hypot(p.nat.w, p.nat.h) / (2 * focal35))) * p.focalMm * p.pxPerMm : p.frame.w;
  const cx = p.frame.x + p.frame.w / 2, cy = p.frame.y + p.frame.h / 2;
  const model = Math.max(Math.abs(p.box.w - w), Math.abs(p.box.h - w * aspect), Math.abs(p.box.cx - cx), Math.abs(p.box.cy - cy));
  // Page layout: the img where the box says, rotation 0.
  const dom = Math.max(Math.abs(p.img.w - p.box.w), Math.abs(p.img.h - p.box.h), Math.abs(p.img.cx - (p.vf.x + p.box.cx)), Math.abs(p.img.cy - (p.vf.y + p.box.cy)));
  return { model, dom, w, ratio: p.box.w / p.frame.w };
};

await tab.viewport(DESKTOP.w, DESKTOP.h);
await viewfinder(TIMES.night, 600);
const renderer = await Tab.renderer(Number(cdp));
check('renderer is ANGLE Metal', /ANGLE Metal/.test(renderer), renderer);

// The Drawn tower, seeded from its Overture rows; suppression keeps the Overture copy out of the occluder.
const seeded = await js<{ source: string; parts: number; suppress: boolean } | null>(`
  for (const m of S.models.getState().models.filter((m) => m.name === ${JSON.stringify(TOWER_NAME)})) await S.models.getState().remove(m.id);
  for (const m of S.markers.getState().markers.filter((m) => m.name === ${JSON.stringify(MARKER_NAME)})) await S.markers.getState().remove(m.id);
  const rows = await buildings.buildingRowsAt(${JSON.stringify(TOWER)});
  const m = rows && seed.seedModel(rows, ${JSON.stringify(TOWER_NAME)});
  if (!m) return null;
  await S.models.getState().save(m);
  return { source: m.source, parts: m.parts.length, suppress: m.suppressOverture };
`);
check('seed a Drawn 30 Hudson Yards', !!seeded && seeded.source === 'Drawn' && seeded.suppress, seeded ? `${seeded.parts} parts, ${seeded.source}, suppressOverture ${seeded.suppress}` : 'no rows');
await viewfinder(TIMES.night, 600);
await js(`S.composition.getState().update({ showBuildings: true, showMoon: true, showSun: true, showMarkers: true, showPaths: false }); return true;`);

// The moon behind the model, then with buildings off, then with the model hidden (the Overture tower is back).
const moonIn = await frameBody('Moon', 600, 'Landscape', BELOW);
const moonInL = await discShot('moon-behind-model', moonIn);
await setBuildings(false);
const moonOff = await bodyNow('Moon');
const moonOffL = await discShot('moon-buildings-off', moonOff);
await setBuildings(true);
await patchModel('{ visible: false }');
const moonOverture = await bodyNow('Moon');
await patchModel('{ visible: true }');
check('night: model hides the Moon disc', !!moonIn?.hidden && !!moonOff && !moonOff.hidden && !!moonOverture?.hidden, `Moon ${moonIn?.az.toFixed(2)}°/${moonIn?.alt.toFixed(2)}° hidden ${moonIn?.hidden}; Buildings off: hidden ${moonOff?.hidden}; model hidden: hidden ${moonOverture?.hidden} (Overture tower returns)`);
check('night: Moon disc pixels behind the model', !!moonInL && !!moonOffL && moonOffL.contrast > 100 && moonInL.contrast < moonOffL.contrast * 0.5, `disc over its surround ${moonInL?.contrast} (${moonInL?.disc} on ${moonInL?.bg}) behind the model, ${moonOffL?.contrast} (${moonOffL?.disc} on ${moonOffL?.bg}) with Buildings off; the picture ghosts a hidden disc at 35%`);

// A moon above the Overture crown: only the model, scaled up, can hide it.
await viewfinder(HIGH_MOON, 600);
await patchModel(`{ anchor: { ...named(${JSON.stringify(TOWER_NAME)}).anchor, scale: 1.5 } }`);
const hiIn = await frameBody('Moon', 600, 'Landscape', BELOW);
const hiInL = await discShot('moon-behind-scaled-model', hiIn);
await patchModel('{ visible: false }');
const hiOut = await bodyNow('Moon');
const hiOutL = await discShot('moon-model-hidden', hiOut);
await patchModel(`{ visible: true, anchor: { ...named(${JSON.stringify(TOWER_NAME)}).anchor, scale: 1 } }`);
check('night: Moon visible again when the model is hidden', !!hiIn?.hidden && !!hiOut && !hiOut.hidden && !!hiInL && !!hiOutL && hiInL.contrast < hiOutL.contrast * 0.5, `Moon ${hiIn?.alt.toFixed(2)}° behind the 1.5× model: hidden ${hiIn?.hidden}, contrast ${hiInL?.contrast}; model hidden: hidden ${hiOut?.hidden}, contrast ${hiOutL?.contrast}`);

// The sun by day.
await viewfinder(TIMES.day, 600);
const sunIn = await frameBody('Sun', 600, 'Landscape', BELOW);
const sunInL = await discShot('sun-behind-model', sunIn);
await setBuildings(false);
const sunOff = await bodyNow('Sun');
const sunOffL = await discShot('sun-buildings-off', sunOff);
await setBuildings(true);
check('day: model hides the Sun disc', !!sunIn?.hidden && !!sunOff && !sunOff.hidden, `Sun ${sunIn?.az.toFixed(2)}°/${sunIn?.alt.toFixed(2)}° hidden ${sunIn?.hidden}, contrast ${sunInL?.contrast}; Buildings off: hidden ${sunOff?.hidden}, contrast ${sunOffL?.contrast}`);

// A marker 450 m past the tower on the same bearing, lower than its crown.
await viewfinder(TIMES.night, 200);
const marker = await js<{ id: string; d: number }>(`
  const pin = S.world.getState().pin, t = named(${JSON.stringify(TOWER_NAME)}).anchor;
  const at = geo.destination(pin, geo.bearingDeg(pin, t), geo.distanceM(pin, t) + 450);
  const m = await S.markers.getState().save({ ...at, name: ${JSON.stringify(MARKER_NAME)}, heightM: 150, widthM: 20, showInViewfinder: true });
  S.composition.getState().update({ focalMm: 200, orientation: 'Landscape' });
  S.composition.getState().aim(geo.bearingDeg(pin, at), 2);
  return { id: m.id, d: geo.distanceM(pin, at) };
`);
await drawn(200, 'Landscape');
const mkIn = await js<boolean | undefined>(`return (await fresh()).markers[${JSON.stringify(marker.id)}];`);
await tab.shot(`${shots}/marker-behind-model.png`, await js<Box>('return frame();'));
await setBuildings(false);
const mkOff = await js<boolean | undefined>(`return (await fresh()).markers[${JSON.stringify(marker.id)}];`);
await setBuildings(true);
check('marker behind the model is occluded', mkIn === true && mkOff === false, `${(marker.d / 1000).toFixed(2)} km out, 150 m tall: occluded ${mkIn}; Buildings off: ${mkOff}`);

// Test cards in the scratchpad: one with Exif FocalLengthIn35mmFilm, one without.
const b64 = await js<string>('return card(1500, 1000);');
const plain = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const exifPath = `${shots}/card-exif-${PHOTO_FOCAL35}mm.jpg`, plainPath = `${shots}/card-plain.jpg`;
await Bun.write(exifPath, withFocal35(plain, PHOTO_FOCAL35));
await Bun.write(plainPath, plain);

// Load, fade and nudge at 200 mm, where a 200 mm-equivalent 3:2 photo fills a 3:2 frame.
await js(`S.composition.getState().update({ focalMm: 200, orientation: 'Landscape' }); const p = sky('Moon'); S.composition.getState().aim(p.azimuth, p.altitude); return true;`);
await drawn(200, 'Landscape');
const loaded = await pickPhoto(exifPath);
await settle(500);
const hint = await tab.eval<string>(`document.querySelector('.vf-photo-tools .hint')?.textContent ?? ''`);
const first = await js<Fit | null>('return fit();');
const e200 = first && fitError(first, PHOTO_FOCAL35);
check('photo loads from a file pick, Exif focal read', !!loaded && first?.focal35 === PHOTO_FOCAL35 && hint.includes(`${PHOTO_FOCAL35} mm`), `${first?.nat.w}×${first?.nat.h}, focal35 ${first?.focal35}; hint "${hint}"`);
check('200 mm: photo fills the frame', !!e200 && e200.model < 0.5 && e200.dom < 1 && Math.abs(e200.ratio - 1) < 0.01, e200 ? `box ${first.box.w.toFixed(1)}×${first.box.h.toFixed(1)} in frame ${first.frame.w.toFixed(1)}×${first.frame.h.toFixed(1)}; off the lens by ${e200.model.toFixed(2)} px, img off the box by ${e200.dom.toFixed(2)} px` : 'no photo');
const setOpacity = (v: number) =>
  tab.eval(`(() => { const i = document.querySelector('input[aria-label="Photo opacity"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '${v}'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const centre = async (name: string) => {
  const f = await js<Box>('return frame();');
  const shot = await tab.shot(`${shots}/${name}.png`, { x: f.x + f.width * 0.3, y: f.y + f.height * 0.3, width: f.width * 0.4, height: f.height * 0.4 });
  return js<{ max: number; mean: number }>(`return luma(${JSON.stringify(shot)});`);
};
await setOpacity(0.2);
await settle(500);
const o20 = await js<{ style: string; dev: number }>(`await fresh(); return { style: document.querySelector('.vf-photo img').style.opacity, dev: S.photo.opacity };`);
const l20 = await centre('photo-opacity-20');
await setOpacity(0.9);
await settle(500);
const o90 = await js<{ style: string; dev: number }>(`await fresh(); return { style: document.querySelector('.vf-photo img').style.opacity, dev: S.photo.opacity };`);
const l90 = await centre('photo-opacity-90');
check('opacity slider fades the photo', o20.style === '0.2' && o20.dev === 0.2 && o90.style === '0.9' && o90.dev === 0.9 && l90.mean > l20.mean + 60, `20%: style ${o20.style}, mean luma ${l20.mean}; 90%: style ${o90.style}, mean luma ${l90.mean}`);
await setOpacity(0.5);
const before = await js<Fit>('return fit();');
await click('Photo right');
await click('Photo up');
await click('Rotate photo clockwise');
await settle(500);
const after = await js<{ box: Fit['box'] }>('await fresh(); return fit();');
const moved = { dx: after.box.cx - before.box.cx, dy: after.box.cy - before.box.cy, rot: after.box.rotDeg - before.box.rotDeg };
const step = 0.002 * before.box.w;
const rotated = await tab.eval<string>(`document.querySelector('.vf-photo img').style.transform`);
await click('Reset');
await settle(300);
const reset = await js<{ box: Fit['box'] }>('await fresh(); return fit();');
check('photo nudges: offset and rotation', Math.abs(moved.dx - step) < 0.01 && Math.abs(moved.dy + step) < 0.01 && Math.abs(moved.rot - 0.1) < 1e-9 && rotated.includes('rotate(0.1') && reset.box.cx === before.box.cx && reset.box.rotDeg === 0, `right/up moved ${moved.dx.toFixed(3)}/${(-moved.dy).toFixed(3)} px (step ${step.toFixed(3)}), turned ${moved.rot.toFixed(2)}° (${rotated}); Reset back to centre`);

// The matrix, desktop: the body behind the model and the photo on the lens at every frame.
const matrix: string[] = [];
let matrixOk = true;
for (const light of [Light.Day, Light.Night]) {
  await viewfinder(TIMES[light], 24);
  await pickPhoto(exifPath);
  for (const orient of ['Landscape', 'Portrait']) {
    for (const f of [24, 200, 600, 2400]) {
      const d = await frameBody(BODY[light], f, orient);
      const p = await js<Fit | null>('return fit();');
      const e = p && fitError(p, PHOTO_FOCAL35);
      const ok = !!d?.hidden && !!e && e.model < 0.5 && e.dom < 1;
      matrixOk &&= ok;
      const name = `${light}-${orient[0]}-${f}`;
      await tab.shot(`${shots}/${name}.png`, await js<Box>('return frame();'));
      matrix.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${BODY[light]} hidden ${d?.hidden}; photo ${e ? `${e.ratio.toFixed(3)}× frame width, off the lens ${e.model.toFixed(2)} px, img off ${e.dom.toFixed(2)} px` : 'missing'} |`);
    }
  }
}
check('matrix: body hidden, photo fitted', matrixOk, `${matrix.length} frames`);

// Without Exif the photo spans the frame at any lens.
const spans: string[] = [];
let spanOk = true;
await pickPhoto(plainPath);
for (const [f, orient] of [[24, 'Landscape'], [600, 'Landscape'], [600, 'Portrait']] as const) {
  await frameBody('Moon', f, orient);
  const p = await js<Fit | null>('return fit();');
  const e = p && fitError(p, null);
  const ok = !!p && p.focal35 === null && !!e && e.model < 0.5 && e.dom < 1;
  spanOk &&= ok;
  spans.push(`${f} ${orient[0]} ${e?.ratio.toFixed(3)}×`);
}
check('no Exif: photo spans the frame', spanOk, spans.join(', '));

// Phone.
await tab.viewport(PHONE.w, PHONE.h);
await viewfinder(TIMES.night, 200);
const phoneLoaded = await pickPhoto(exifPath);
const phone: string[] = [];
let phoneOk = !!phoneLoaded;
for (const [f, orient] of [[200, 'Portrait'], [600, 'Landscape']] as const) {
  await frameBody('Moon', f, orient);
  const p = await js<Fit | null>('return fit();');
  const e = p && fitError(p, PHOTO_FOCAL35);
  phoneOk &&= !!e && e.model < 0.5 && e.dom < 1;
  phone.push(`${f} ${orient[0]}: ${e ? `${e.ratio.toFixed(3)}× frame, off ${Math.max(e.model, e.dom).toFixed(2)} px` : 'missing'}`);
  await tab.shot(`${shots}/phone-${orient[0]}-${f}.png`);
}
const tools = await tab.eval<{ fits: boolean; controls: number }>(`(() => { const t = document.querySelector('.vf-photo-tools'); t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return { fits: r.left >= 0 && r.right <= innerWidth + 0.5 && r.width > 0, controls: t.querySelectorAll('button, input[type=range]').length }; })()`);
await settle(500);
await tab.shot(`${shots}/phone-photo-tools.png`);
check('phone 390×844: photo fits, controls in reach', phoneOk && tools.fits && tools.controls >= 10, `${phone.join('; ')}; ${tools.controls} controls, ${tools.fits ? 'within the width' : 'overflowing'}`);

await click('Clear photo');
const cleared = await tab.until<boolean>(`window.__scape.photo === null && document.querySelector('.vf-photo').hidden`, 5000, 100);
check('Clear photo removes the layer', !!cleared, cleared ? 'layer hidden, no photo state' : 'still shown');

await js(`
  for (const m of S.models.getState().models.filter((m) => m.name === ${JSON.stringify(TOWER_NAME)})) await S.models.getState().remove(m.id);
  for (const m of S.markers.getState().markers.filter((m) => m.name === ${JSON.stringify(MARKER_NAME)})) await S.markers.getState().remove(m.id);
  return true;
`);
await tab.send('Emulation.clearDeviceMetricsOverride', {});
await tab.navigate(`${BASE}/`);
tab.close();
console.log('| Check | Result | Numbers |\n| --- | --- | --- |');
console.log(rows.join('\n'));
console.log('\n| Frame | Result | Numbers |\n| --- | --- | --- |');
console.log(matrix.join('\n'));
process.exit(failed ? 1 : 0);
