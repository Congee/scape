// Precise models P2 smoke: drawing, the cross-tile seed, the map's hidden extrusions, the viewfinder outline and nudges.
/* oxlint-disable no-await-in-loop -- smoke steps run one frame at a time */
// Usage: bun scripts/smoke/models-p2.ts <cdp> <dev-port> <preview-port|-> <shot-dir>
import { Tab } from './cdp';

const [cdp = '9342', port = '5320', , shots = '/tmp/models-p2'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const TOWER_NAME = '30 Hudson Yards (P2 smoke)';
const LIBRARY_NAME = 'NY Public Library (P2 smoke)';
const TOWER = { lat: 40.754, lng: -74.0008 };
// The library's footprint crosses the z14 column edge at 73.98193° W.
const LIBRARY = { lat: 40.7532, lng: -73.9822 };
const Z14_EDGE_LNG = (4825 / 16384) * 360 - 180;
const HOBOKEN = '40.7527,-74.0225';
// Bryant Park's lawn to draw on; the camera 300 m west along 42nd Street.
const LAWN = { lat: 40.7536, lng: -73.9837 };
const LAWN_CAMERA = '40.7536,-73.9873';
// A dense block south of the park, for a vertex to snap to.
const BLOCK = { lat: 40.7515, lng: -73.9845 };
const Light = { Day: 'day', Low: 'low', Night: 'night' } as const;
type Light = (typeof Light)[keyof typeof Light];
const TIMES: Record<Light, string> = { day: '2026-09-24T20:30Z', low: '2026-06-21T23:56Z', night: '2026-09-25T03:00Z' };
const PHONE = { w: 390, h: 844 };
const DESKTOP = { w: 1280, h: 800 };

type Box = { x: number; y: number; width: number; height: number };
type Edges = { x0: number; y0: number; x1: number; y1: number };

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
  const [buildings, seed, geo, proj, ui, core] = await Promise.all(['state/buildings', 'core/model/seed', 'core/geo/geodesy', 'core/optics/projection', 'state/ui', 'core/model'].map((m) => imp('/src/lib/' + m + '.ts')));
  const S = window.__scape;
  const named = (name) => S.models.getState().models.find((m) => m.name === name) ?? null;
  const map = () => window.__scapeMap;
  const idle = async () => { const m = map(); m.triggerRepaint(); return new Promise((r) => { const t = setTimeout(() => r(false), 20000); m.once('idle', () => { clearTimeout(t); r(true); }); }); };
  const frame = () => {
    const r = document.querySelector('.vf-gl').getBoundingClientRect(), f = S.prism.cam.frame;
    return { x: r.left + f.x, y: r.top + f.y, width: f.w, height: f.h };
  };
  /** The outline box the vf canvas reports, in page px. */
  const outline = () => {
    const o = S.modelOutline, r = document.querySelector('canvas.vf').getBoundingClientRect();
    return o && o.box && { id: o.id, segments: o.segments, x0: r.left + o.box.x0, y0: r.top + o.box.y0, x1: r.left + o.box.x1, y1: r.top + o.box.y1 };
  };
  /** Page-px box of a parts model's prism corners, projected here rather than by the renderer. */
  const predicted = (m) => {
    const cam = S.prism.cam, pin = S.world.getState().pin, basis = proj.cameraBasis(cam);
    const r = document.querySelector('.vf-gl').getBoundingClientRect();
    const base = core.modelBaseM(m.anchor, m.groundM);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of m.parts) for (const [e, n] of p.ring) for (const h of [p.baseM, p.heightM]) {
      const g = core.localToLngLat(m.anchor, e, n), d = geo.distanceM(pin, g);
      const alt = Math.atan2(base + h * m.anchor.scale - cam.eyeM - geo.curvatureDropM(d), d) * 180 / Math.PI;
      const s = proj.project(cam, basis, geo.bearingDeg(pin, g), alt);
      if (!s) continue;
      const x = r.left + cam.frame.x + cam.frame.w / 2 + s.x * cam.frame.pxPerMm, y = r.top + cam.frame.y + cam.frame.h / 2 - s.y * cam.frame.pxPerMm;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
  };
  /** Aims at a point of the model: its centre at a share of its height. */
  const aimAt = (m, share) => {
    const pin = S.world.getState().pin, top = Math.max(...m.parts.map((p) => p.heightM));
    const c = core.localToLngLat(m.anchor, 0, 0), d = geo.distanceM(pin, c);
    S.composition.getState().aim(geo.bearingDeg(pin, c), Math.atan2(core.modelBaseM(m.anchor, m.groundM) + top * share - S.prism.cam.eyeM - geo.curvatureDropM(d), d) * 180 / Math.PI);
  };
  /** Input values wider than their boxes. */
  const clipped = (sel) => [...document.querySelectorAll(sel + ' input')].filter((i) => i.type !== 'checkbox' && i.offsetWidth > 0 && i.scrollWidth > i.clientWidth + 1).map((i) => i.getAttribute('aria-label') + '=' + i.value);
  const decode = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => { const c = new OffscreenCanvas(i.width, i.height).getContext('2d'); c.drawImage(i, 0, 0); res({ d: c.getImageData(0, 0, i.width, i.height).data, w: i.width, h: i.height }); }; i.src = 'data:image/png;base64,' + b64; });
  /** 95th percentile over columns of luminance-slope sign flips down the column: stripes flip often, smooth shading rarely. */
  const banding = async (b64) => {
    const { d, w, h } = await decode(b64);
    const L = (x, y) => { const k = (y * w + x) * 4; return 0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2]; };
    const counts = [];
    for (let x = 0; x < w; x += 2) { let n = 0, last = 0; for (let y = 3; y < h; y += 3) { const g = L(x, y) - L(x, y - 3); if (Math.abs(g) < 5) continue; const s = Math.sign(g); if (last && s !== last) n++; last = s; } counts.push(n); }
    counts.sort((a, b) => a - b);
    return { p95: counts[Math.floor(counts.length * 0.95)], max: counts[counts.length - 1] };
  };
  window.__smoke = { buildings, seed, geo, ui, core, named, map, idle, frame, outline, predicted, aimAt, clipped, banding };
  return true;
})()`;

const js = <T = unknown>(body: string, timeoutMs = 60_000) =>
  tab.eval<T>(`(async () => { await ${HELPERS}; const { buildings, seed, geo, ui, core, named, map, idle, frame, outline, predicted, aimAt, clipped, banding } = window.__smoke; const S = window.__scape; ${body} })()`, timeoutMs);
const settle = (ms = 1500) => Bun.sleep(ms);
const tap = async (x: number, y: number) => {
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await settle(250);
};
const click = (label: string) => tab.eval<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`);
const openModels = () => js(`ui.uiStore.getState().setPanelTab('Markers'); ui.uiStore.getState().setMarkersView('Models'); return true;`);
const home = async () => {
  await tab.navigate(`${BASE}/`);
  await tab.until('!!window.__scape?.models?.getState().loaded && !!window.__scapeMap', 60_000);
};
/** Waits for a frame drawn with the wanted focal and orientation, then for tiles to land. */
const drawn = async (focal: number, orient: string) => {
  const ok = await tab.until(`(() => { const p = window.__scape?.prism; return p && p.cam && Math.abs(p.cam.focalMm - ${focal}) < 1e-6 && (p.cam.frameWmm > p.cam.frameHmm) === ${orient === 'Landscape'} && p.terrain; })()`, 60_000, 300);
  if (!ok) throw new Error(`no ${focal} mm ${orient} frame within 60 s`);
  await tab.until(`!window.__scape.buildings.getState().busy`, 30_000, 300);
  await settle();
};
const viewfinder = async (camera: string, target: { lat: number; lng: number }, t: string, f: number) => {
  await tab.navigate(`${BASE}/viewfinder?camera=${camera}&target=${target.lat},${target.lng}&f=${f}&t=${t}`);
  await tab.until('!!window.__scape?.prism?.cam', 60_000);
  await js('S.world.getState().setPinHeight(0); return true;');
};
const seedAt = (at: { lat: number; lng: number }, name: string) =>
  js<{ parts: number; lng0: number; lng1: number; tile: string } | null>(`
  for (const m of S.models.getState().models.filter((m) => m.name === ${JSON.stringify(name)})) await S.models.getState().remove(m.id);
  const rows = await buildings.buildingRowsAt(${JSON.stringify(at)});
  const m = rows && seed.seedModel(rows, ${JSON.stringify(name)});
  if (!m) return null;
  await S.models.getState().save(m);
  let lng0 = Infinity, lng1 = -Infinity;
  for (let j = 0; j < rows.ringStart[rows.count]; j++) { lng0 = Math.min(lng0, rows.lng[j]); lng1 = Math.max(lng1, rows.lng[j]); }
  return { parts: m.parts.length, lng0, lng1, tile: rows.tileKey };
`);

// Renderer.
await tab.viewport(DESKTOP.w, DESKTOP.h);
await home();
const renderer = await tab.eval<string>(`(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); })()`);
check('renderer is ANGLE Metal', /ANGLE Metal/.test(renderer), renderer);
await js(`for (const m of S.models.getState().models.filter((m) => m.notes === 'p2-smoke')) await S.models.getState().remove(m.id); return true;`);

// A building across a z14 column edge seeds whole.
const lib = await seedAt(LIBRARY, LIBRARY_NAME);
check('seed across a tile edge', !!lib && lib.lng0 < Z14_EDGE_LNG - 1e-4 && lib.lng1 > Z14_EDGE_LNG + 1e-4, lib ? `${lib.parts} parts from ${lib.tile}, lng ${lib.lng0.toFixed(5)}…${lib.lng1.toFixed(5)} across ${Z14_EDGE_LNG.toFixed(5)}` : 'no rows');

// The Overture extrusion under a suppressing model leaves the map, by id.
const hidden = await js<{ ids: number; inFilter: boolean; inSource: boolean; shownOn: number; shownOff: number }>(`
  const m = named(${JSON.stringify(LIBRARY_NAME)});
  const c = core.localToLngLat(m.anchor, 0, 0);
  map().jumpTo({ center: [c.lng, c.lat], zoom: 17, pitch: 45, bearing: 0 });
  await idle();
  const layers = ['overture-building', 'overture-building-part'];
  const shown = async (keep) => {
    await new Promise((r) => setTimeout(r, 2500)); await idle();
    const p = map().project([c.lng, c.lat]);
    const ids = keep ?? new Set((await buildings.suppressedBuildingIds()) ?? []);
    return { ids, n: map().queryRenderedFeatures([[p.x - 60, p.y - 60], [p.x + 60, p.y + 60]], { layers }).filter((f) => ids.has(f.properties.id)).length };
  };
  await S.models.getState().update(m.id, { suppressOverture: true });
  const on = await shown();
  const filter = JSON.stringify(layers.map((l) => map().getFilter(l)));
  const inSource = ['building', 'building_part'].some((sl) => map().querySourceFeatures('overture-buildings', { sourceLayer: sl }).some((f) => on.ids.has(f.properties.id)));
  await S.models.getState().update(m.id, { suppressOverture: false });
  const off = await shown(on.ids);
  await S.models.getState().update(m.id, { suppressOverture: true });
  await shown();
  return { ids: on.ids.size, inFilter: [...on.ids].every((id) => filter.includes(id)), inSource, shownOn: on.n, shownOff: off.n };
`, 120_000);
await tab.shot(`${shots}/map-library-suppressed.png`);
check('map hides the Overture extrusion under the model', hidden.ids > 0 && hidden.inFilter && hidden.inSource && hidden.shownOn === 0 && hidden.shownOff > 0, `${hidden.ids} ids in the filter ${hidden.inFilter ? 'yes' : 'no'}, in the tiles ${hidden.inSource ? 'yes' : 'no'}; rendered under the model ${hidden.shownOn} suppressed, ${hidden.shownOff} with suppression off`);

// The editor's fields hold their text at desktop width.
await seedAt(TOWER, TOWER_NAME);
await js(`S.models.getState().select(named(${JSON.stringify(TOWER_NAME)}).id); return true;`);
await openModels();
await tab.until(`!!document.querySelector('.model-editor .nudge-pad')`, 10_000);
await settle(500);
const deskClipped = await js<string[]>(`return clipped('.model-editor');`);
const editorBox = await tab.eval<Box>(`(() => { const r = document.querySelector('.model-editor').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 1600) }; })()`);
await tab.shot(`${shots}/editor-desktop.png`, editorBox);
check('desktop editor fields not truncated', deskClipped.length === 0, deskClipped.length ? deskClipped.join(', ') : 'every input fits its text');

// Phone: snap a tap to an Overture corner, then draw a footprint by taps.
await tab.viewport(PHONE.w, PHONE.h);
await home();
await openModels();
// Drawing first: its bar resizes the sheet, and so the map.
await click('Draw a building');
await tab.until(`window.__scape.models.getState().draft !== null`, 5000, 100);
await settle(500);
const corner = await js<{ at: [number, number]; x: number; y: number } | null>(`
  map().jumpTo({ center: [${BLOCK.lng}, ${BLOCK.lat}], zoom: 18.5, pitch: 0, bearing: 0 });
  await idle(); await new Promise((r) => setTimeout(r, 1500)); await idle();
  const r = map().getCanvas().getBoundingClientRect();
  // Clear of the controls and the pin chips.
  const safe = (p) => p.x > 40 && p.x < r.width - 80 && p.y > 70 && p.y < r.height - 50;
  const pts = [];
  for (const f of map().queryRenderedFeatures({ layers: ['overture-building', 'overture-building-part'] })) {
    const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const c of poly[0]) pts.push({ c, p: map().project(c) });
  }
  const lone = pts.filter((a) => safe(a.p) && pts.every((b) => b === a || (b.c[0] === a.c[0] && b.c[1] === a.c[1]) || Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) > 24));
  // The drawer's own query: the nearest vertex of the features in a box about the tap.
  const near = (t) => {
    let best = null, bd = 12;
    for (const f of map().queryRenderedFeatures([[t.x - 12, t.y - 12], [t.x + 12, t.y + 12]], { layers: ['overture-building', 'overture-building-part'] })) {
      const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) for (const ring of poly) for (const c of ring) { const p = map().project(c), d = Math.hypot(p.x - t.x, p.y - t.y); if (d <= bd) { bd = d; best = c; } }
    }
    return best;
  };
  // Tiles clip a footprint differently, so keep a corner the box query also finds.
  const a = lone.find((a) => { const n = near({ x: a.p.x + 5, y: a.p.y + 4 }); return n && n[0] === a.c[0] && n[1] === a.c[1]; });
  return a ? { at: a.c, x: r.left + a.p.x, y: r.top + a.p.y } : null;
`, 120_000);
let snapped: [number, number] | null = null;
if (corner) {
  await tap(corner.x + 5, corner.y + 4);
  snapped = await js<[number, number] | null>(`return S.models.getState().draft?.[0] ?? null;`);
  await tab.shot(`${shots}/phone-snap.png`);
}
await click('Cancel');
check('tap snaps to an Overture vertex', !!corner && !!snapped && snapped[0] === corner.at[0] && snapped[1] === corner.at[1], corner ? `tapped 6.4 px off ${corner.at.map((v) => v.toFixed(6)).join(',')}, got ${snapped?.map((v) => v.toFixed(6)).join(',')}` : 'no lone corner in view');

const before = await js<number>('return S.models.getState().models.length;');
const taps = await js<{ x: number; y: number }[]>(`
  map().jumpTo({ center: [${LAWN.lng}, ${LAWN.lat}], zoom: 17, pitch: 0, bearing: 0 });
  await idle();
  const r = map().getCanvas().getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = 70;
  return [{ x: cx - d, y: cy - d }, { x: cx + d, y: cy - d }, { x: cx + d, y: cy + d }, { x: cx - d, y: cy + d }];
`);
await click('Draw a building');
await tab.until(`window.__scape.models.getState().draft !== null`, 5000, 100);
for (const t of taps) await tap(t.x, t.y);
const draftN = await js<number>('return S.models.getState().draft?.length ?? -1;');
await tab.shot(`${shots}/phone-draft.png`);
// Closing the ring: a tap on the first handle.
const first = await js<{ x: number; y: number }>(`const p = map().project(S.models.getState().draft[0]), r = map().getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y };`);
await tap(first.x, first.y);
const made = await tab.until<{ id: string; parts: number; ring: number; source: string; heightM: number } | null>(
  `(() => { const s = window.__scape.models.getState(); if (s.draft || s.models.length <= ${before}) return null; const m = s.models.find((m) => m.id === s.selectedId); return m && { id: m.id, parts: m.parts.length, ring: m.parts[0].ring.length, source: m.source, heightM: m.parts[0].heightM }; })()`,
  10_000,
  200
);
if (made) await js(`await S.models.getState().update(${JSON.stringify(made.id)}, { notes: 'p2-smoke' }); return true;`);
await tab.until(`!!document.querySelector('.model-editor.compact .nudge-pad')`, 10_000);
await settle(800);
await tab.shot(`${shots}/phone-drawn.png`);
const phoneClipped = await js<string[]>(`return clipped('.model-editor');`);
check('draw 4 corners by taps at 390×844', draftN === 4 && !!made && made.parts === 1 && made.ring === 4 && made.source === 'Drawn', made ? `${draftN} taps → ${made.source} model, ${made.parts} part, ${made.ring} corners, ${made.heightM} m` : `${draftN} taps, no model`);
// Every model has a known ground, and the drawn one's base meets the DEM the terrain worker reads at its anchor.
const ground = await js<{ bad: string[]; baseM: number; demM: number | null }>(`
  const bad = S.models.getState().models.filter((m) => !Number.isFinite(m.groundM)).map((m) => m.name + ' ' + m.groundM);
  const m = S.models.getState().models.find((m) => m.id === ${JSON.stringify(made?.id ?? '')});
  if (!m) return { bad, baseM: NaN, demM: null };
  S.world.getState().setPin({ lat: m.anchor.lat, lng: m.anchor.lng });
  const key = m.anchor.lat.toFixed(5) + ',' + m.anchor.lng.toFixed(5) + '|', at = () => S.terrain.getState().elevationKey.startsWith(key), t0 = performance.now();
  while (!at() && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
  return { bad, baseM: core.modelBaseM(m.anchor, m.groundM), demM: at() ? S.terrain.getState().pinGroundM : null };
`);
check(
  'every model has a finite ground; the drawn base sits on the terrain',
  ground.bad.length === 0 && ground.demM !== null && Math.abs(ground.baseM - Math.max(ground.demM, 0)) < 2,
  `${ground.bad.length ? `NaN ground: ${ground.bad.join(', ')}` : 'all finite'}; drawn base ${ground.baseM.toFixed(2)} m, DEM at its anchor ${ground.demM?.toFixed(2) ?? 'unknown'} m`
);
// A model saved while the DEM was unreadable gets its ground back on the next load.
const healed = await js<{ was: number; now: number; ms: number } | null>(`
  const st = S.models.getState(), m = st.models.find((m) => m.id === ${JSON.stringify(made?.id ?? '')});
  if (!m) return null;
  await st.save({ ...m, groundM: NaN });
  const t0 = performance.now(), g = () => S.models.getState().models.find((x) => x.id === m.id).groundM;
  while (Number.isNaN(g()) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
  return { was: m.groundM, now: g(), ms: Math.round(performance.now() - t0) };
`);
check('a NaN ground heals on load', !!healed && healed.now === healed.was, healed ? `${healed.was.toFixed(2)} → NaN → ${healed.now.toFixed(2)} m in ${healed.ms} ms` : 'no drawn model');
// A burst of three 100 m east moves re-reads the ground once it settles, then the move back restores it.
const shifted = await js<{ was: number; now: number; want: number | null; back: number; ms: number } | null>(`
  const id = ${JSON.stringify(made?.id ?? '')}, get = () => S.models.getState().models.find((x) => x.id === id);
  const m = get();
  if (!m) return null;
  const was = m.groundM, home = m.anchor;
  for (let i = 0; i < 3; i++) { const a = get().anchor, to = geo.destination(a, 90, 100); await S.models.getState().update(id, { anchor: { ...a, lat: to.lat, lng: to.lng } }); }
  const t0 = performance.now();
  while (get().groundM === was && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
  const ms = Math.round(performance.now() - t0), now = get().groundM;
  const want = await buildings.groundUnder(get().footprint.map(([lng, lat]) => ({ lng, lat })));
  await S.models.getState().update(id, { anchor: home });
  const t1 = performance.now();
  while (get().groundM !== was && performance.now() - t1 < 20000) await new Promise((r) => setTimeout(r, 100));
  return { was, now, want, back: get().groundM, ms };
`);
check(
  'a 300 m move re-reads the ground under the new footprint',
  !!shifted && shifted.want !== null && Math.abs(shifted.now - shifted.was) > 0.5 && Math.abs(shifted.now - shifted.want) < 1e-6 && shifted.back === shifted.was,
  shifted ? `${shifted.was.toFixed(2)} m → ${shifted.now.toFixed(2)} m in ${shifted.ms} ms (lowest ground there ${shifted.want?.toFixed(2) ?? 'unknown'} m); back home ${shifted.back.toFixed(2)} m` : 'no drawn model'
);
check('phone editor: compact pad, fields not truncated', phoneClipped.length === 0, phoneClipped.length ? phoneClipped.join(', ') : 'nudge pad in the sheet, every input fits');

// The viewfinder outline follows a 1° heading nudge from the pad.
let nudge = { ok: false, detail: 'no drawn model' };
if (made) {
  const lawnAt = await js<{ lat: number; lng: number }>(`const m = S.models.getState().models.find((m) => m.id === ${JSON.stringify(made.id)}); return { lat: m.anchor.lat, lng: m.anchor.lng };`);
  await viewfinder(LAWN_CAMERA, lawnAt, TIMES.day, 200);
  // Above the lawn, so the eye looks down on the model's base and every prism corner is on its silhouette.
  await js('S.world.getState().setPinHeight(30); return true;');
  await js(`S.models.getState().select(${JSON.stringify(made.id)}); S.composition.getState().update({ focalMm: 200, orientation: 'Landscape' }); aimAt(S.models.getState().models.find((m) => m.id === ${JSON.stringify(made.id)}), 0.5); return true;`);
  await openModels();
  await drawn(200, 'Landscape');
  await tab.until(`window.__scape.modelOutline?.id === ${JSON.stringify(made.id)}`, 10_000, 200);
  const read = () => js<{ o: Edges & { segments: number }; p: Edges; h: number }>(`const m = S.models.getState().models.find((m) => m.id === ${JSON.stringify(made.id)}); return { o: outline(), p: predicted(m), h: m.anchor.headingDeg };`);
  const a = await read();
  await tab.shot(`${shots}/phone-vf-before.png`);
  const raw = await tab.eval<string>('JSON.stringify(window.__scape.modelOutline?.box)');
  const pressed = await click('Heading +1 °');
  await tab.until(`JSON.stringify(window.__scape.modelOutline?.box) !== ${JSON.stringify(raw)}`, 10_000, 100);
  await settle(500);
  const b = await read();
  await tab.shot(`${shots}/phone-vf-after.png`);
  const k = ['x0', 'y0', 'x1', 'y1'] as const;
  const fit = Math.max(...k.map((q) => Math.abs(a.o[q] - a.p[q])), ...k.map((q) => Math.abs(b.o[q] - b.p[q])));
  const moved = Math.max(...k.map((q) => Math.abs(b.o[q] - a.o[q])));
  const follow = Math.max(...k.map((q) => Math.abs(b.o[q] - a.o[q] - (b.p[q] - a.p[q]))));
  nudge = {
    ok: pressed && Math.abs(b.h - a.h - 1) < 1e-6 && a.o.segments > 0 && moved > 1 && follow < 0.5 && fit < 2,
    detail: `heading ${a.h.toFixed(2)}° → ${b.h.toFixed(2)}°, ${b.o.segments} segments; outline moved ${moved.toFixed(2)} px, off the projected prism by ${fit.toFixed(2)} px, change off by ${follow.toFixed(3)} px; edges off ${k.map((q) => (a.o[q] - a.p[q]).toFixed(2)).join('/')}`
  };
}
check('outline follows a 1° heading nudge (phone viewfinder)', nudge.ok, nudge.detail);

// The matrix, desktop: the selected tower's outline in every frame.
await tab.viewport(DESKTOP.w, DESKTOP.h);
const matrix: string[] = [];
let matrixOk = true;
for (const light of [Light.Day, Light.Night]) {
  await viewfinder(HOBOKEN, TOWER, TIMES[light], 24);
  await js(`S.models.getState().select(named(${JSON.stringify(TOWER_NAME)}).id); return true;`);
  for (const orient of ['Landscape', 'Portrait']) {
    for (const f of [24, 200, 600, 2400]) {
      // Past 200 mm the frame holds only part of the tower: aim at its crown edge.
      await js(`S.composition.getState().update({ focalMm: ${f}, orientation: '${orient}' }); aimAt(named(${JSON.stringify(TOWER_NAME)}), ${f > 200 ? 0.98 : 0.5}); return true;`);
      await drawn(f, orient);
      const p = await js<{ models: number; o: (Edges & { segments: number }) | null; fr: Box }>('return { models: S.prism.models, o: outline(), fr: frame() };');
      const inFrame = !!p.o && p.o.x1 > p.fr.x && p.o.x0 < p.fr.x + p.fr.width && p.o.y1 > p.fr.y && p.o.y0 < p.fr.y + p.fr.height;
      const ok = p.models >= 1 && !!p.o && p.o.segments > 0 && inFrame;
      matrixOk &&= ok;
      const name = `${light}-${orient[0]}-${f}`;
      await tab.shot(`${shots}/${name}.png`, p.fr);
      matrix.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | models ${p.models}, outline ${p.o?.segments ?? 0} segments${inFrame ? ' in frame' : ', off frame'} |`);
    }
  }
}
check('matrix: model drawn and outlined', matrixOk, `${matrix.length} frames`);

// No shadow banding on the tower at 600 mm under a low sun.
await viewfinder(HOBOKEN, TOWER, TIMES.low, 600);
await js(`S.models.getState().select(null); S.composition.getState().update({ focalMm: 600, orientation: 'Landscape' }); aimAt(named(${JSON.stringify(TOWER_NAME)}), 0.97); return true;`);
await drawn(600, 'Landscape');
await settle(3000);
const bandShot = await tab.shot(`${shots}/shadow-600-low.png`, await js<Box>('return frame();'));
const band = await js<{ p95: number; max: number; sun: number }>(`return { ...(await banding(${JSON.stringify(bandShot)})), sun: S.prism.cam.sunAlt };`);
check('no shadow banding at 600 mm, low sun', band.p95 <= 3, `p95 ${band.p95} slope flips per column (max ${band.max}), sun ${band.sun.toFixed(1)}°`);

await js(`for (const m of S.models.getState().models.filter((m) => m.notes === 'p2-smoke' || m.name === ${JSON.stringify(TOWER_NAME)} || m.name === ${JSON.stringify(LIBRARY_NAME)})) await S.models.getState().remove(m.id); return true;`);
await tab.send('Emulation.clearDeviceMetricsOverride', {});
await tab.navigate(`${BASE}/`);
tab.close();
console.log('| Check | Result | Numbers |\n| --- | --- | --- |');
console.log(rows.join('\n'));
console.log('\n| Frame | Result | Numbers |\n| --- | --- | --- |');
console.log(matrix.join('\n'));
process.exit(failed ? 1 : 0);
