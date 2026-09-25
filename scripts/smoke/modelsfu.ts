// Models follow-ups smoke: Overture under a model, seeding across z14 tiles, closed meshes, and outlines that respect occluders.
/* oxlint-disable no-await-in-loop -- smoke steps run one frame at a time */
// Usage: bun scripts/smoke/modelsfu.ts <cdp> <dev-port> <shot-dir>
import { Tab } from './cdp';

const [cdp = '9550', port = '5550', shots = '/tmp/modelsfu'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const TOWER_NAME = 'modelsfu 30 Hudson Yards';
const TOWER = { lat: 40.754, lng: -74.0008 };
// The Javits Center straddles the z14 column edge at 74.00391° W.
const JAVITS = { lat: 40.7577, lng: -74.0023 };
const TILE_EDGE_LNG = -74.00390625;
const HOBOKEN = '40.7527,-74.0225';
// West of First Watchung Mountain: the ridge stands between the camera and Manhattan.
const RIDGE = '40.787,-74.32';
// Bryant Park's lawn, with 40th Street's towers south of it.
const LAWN = { lat: 40.7536, lng: -73.9837 };
const Light = { Day: 'day', Night: 'night' } as const;
type Light = (typeof Light)[keyof typeof Light];
const TIMES: Record<Light, string> = { day: '2026-09-24T20:30Z', night: '2026-09-25T03:00Z' };
const Tag = { Hidden: 'modelsfu hidden', Clear: 'modelsfu clear', Lawn: 'modelsfu lawn', Javits: 'modelsfu javits' } as const;
const PHONE = { w: 390, h: 844 };

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
await tab.fresh(BASE);
await tab.viewport(1280, 800);

const HELPERS = `(async () => {
  if (window.__smoke) return true;
  // The URL the app loaded, which after HMR carries a ?t= stamp; a bare import would make a second store.
  const imp = (path) => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === path) ?? path);
  const [buildings, seed, geo, core, draw, mesh, share, state] = await Promise.all(
    ['state/buildings', 'core/model/seed', 'core/geo/geodesy', 'core/model', 'core/model/draw', 'core/model/mesh', 'core/model/share', 'state/models'].map((m) => imp('/src/lib/' + m + '.ts'))
  );
  const S = window.__scape;
  const map = () => window.__scapeMap;
  const named = (name) => S.models.getState().models.find((m) => m.name === name) ?? null;
  const drop = async (name) => { for (const m of S.models.getState().models.filter((m) => m.name === name)) await S.models.getState().remove(m.id); };
  /** A flat square block, h metres tall, w metres a side, on the DEM. */
  const block = async (name, c, w, h) => {
    await drop(name);
    const d = geo.destination, pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => d(d(c, 90, (x * w) / 2), 0, (y * w) / 2));
    const m = draw.drawnModel(pts, name, h);
    m.groundM = NaN;
    await S.models.getState().save(m);
    await state.retryGround(m.id);
    return named(name);
  };
  const seedAt = async (name, p) => {
    await drop(name);
    const rows = await buildings.buildingRowsAt(p);
    const m = rows && seed.seedModel(rows, name);
    if (m) await S.models.getState().save(m);
    return m ? named(name) : null;
  };
  const centre = (m) => ({ lng: m.footprint.reduce((a, q) => a + q[0], 0) / m.footprint.length, lat: m.footprint.reduce((a, q) => a + q[1], 0) / m.footprint.length });
  const top = (m) => seed.modelApexM(m.parts);
  /** Bearing and altitude from the pin to a model's centre at height share f of its top. */
  const aimAt = (m, f) => {
    const pin = S.world.getState().pin, c = centre(m), d = geo.distanceM(pin, c), g = Number.isNaN(m.groundM) ? 0 : m.groundM;
    return { az: geo.bearingDeg(pin, c), alt: Math.atan2(g + top(m) * f - S.prism.cam.eyeM - geo.curvatureDropM(d), d) * 180 / Math.PI };
  };
  const idle = () => { const m = map(); m.triggerRepaint(); return new Promise((r) => { const t = setTimeout(() => r(false), 20000); m.once('idle', () => { clearTimeout(t); r(true); }); }); };
  const canvas = () => { const r = map().getCanvas().getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  const frame = () => { const r = document.querySelector('.vf-gl').getBoundingClientRect(), f = S.prism.cam.frame; return { x: r.left + f.x, y: r.top + f.y, width: f.w, height: f.h }; };
  const decode = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => { const c = new OffscreenCanvas(i.width, i.height).getContext('2d'); c.drawImage(i, 0, 0); res(c.getImageData(0, 0, i.width, i.height).data); }; i.src = 'data:image/png;base64,' + b64; });
  /** Share of pixels whose largest channel change exceeds tol. */
  const diff = async (a, b, tol = 24) => {
    const [p, q] = await Promise.all([decode(a), decode(b)]);
    if (p.length !== q.length) return 1;
    let n = 0;
    for (let i = 0; i < p.length; i += 4) if (Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2])) > tol) n++;
    return n / (p.length / 4);
  };
  /** Directed edges without a reverse twin: zero for a closed solid. */
  const openEdges = (pos) => {
    const key = (i) => pos[i].toFixed(4) + ',' + pos[i + 1].toFixed(4) + ',' + pos[i + 2].toFixed(4);
    const edges = new Map();
    for (let t = 0; t < pos.length; t += 9) for (const [a, b] of [[t, t + 3], [t + 3, t + 6], [t + 6, t]]) {
      const back = key(b) + '|' + key(a), n = edges.get(back) ?? 0;
      if (n > 0) edges.set(back, n - 1);
      else edges.set(key(a) + '|' + key(b), (edges.get(key(a) + '|' + key(b)) ?? 0) + 1);
    }
    return [...edges.values()].reduce((s, n) => s + n, 0);
  };
  window.__smoke = { buildings, seed, geo, core, mesh, share, S, map, named, drop, block, seedAt, centre, top, aimAt, idle, canvas, frame, diff, openEdges };
  return true;
})()`;
const js = <T = unknown>(body: string, timeoutMs = 90_000) =>
  tab.eval<T>(`(async () => { await ${HELPERS}; const { buildings, seed, geo, core, mesh, share, S, map, named, drop, block, seedAt, centre, top, aimAt, idle, canvas, frame, diff, openEdges } = window.__smoke; ${body} })()`, timeoutMs);
const settle = (ms = 1500) => Bun.sleep(ms);
const home = async () => {
  await tab.navigate(`${BASE}/`);
  await tab.until('!!window.__scape?.models?.getState().loaded && !!window.__scapeMap', 60_000);
};

await home();
const renderer = await Tab.renderer(Number(cdp));
check('renderer is ANGLE Metal', /ANGLE Metal/.test(renderer), renderer);

// 1. Overture's extrusions leave the map under a visible model and come back when it is hidden.
const tower = await js<{ parts: number; apex: number }>(`
  const m = await seedAt(${JSON.stringify(TOWER_NAME)}, ${JSON.stringify(TOWER)});
  return { parts: m?.parts.length ?? 0, apex: m ? top(m) : 0 };
`);
const overture = async (visible: boolean) => {
  await js(`await S.models.getState().update(named(${JSON.stringify(TOWER_NAME)}).id, { visible: ${visible} }); return true;`);
  await settle(1500);
  return js<number>(`
    map().jumpTo({ center: ${JSON.stringify(TOWER)}, zoom: 17, pitch: 0, bearing: 0 });
    await idle();
    const p = map().project(centre(named(${JSON.stringify(TOWER_NAME)})));
    return map().queryRenderedFeatures([[p.x - 4, p.y - 4], [p.x + 4, p.y + 4]], { layers: ['overture-building', 'overture-building-part'] }).length;
  `);
};
const shownRows = await overture(true);
await tab.shot(`${shots}/map-tower-visible.png`, await js('return canvas();'));
const hiddenRows = await overture(false);
await tab.shot(`${shots}/map-tower-hidden.png`, await js('return canvas();'));
await overture(true);
check('models-fill: Overture hidden under a visible model only', tower.parts >= 10 && shownRows === 0 && hiddenRows > 0, `${tower.parts} parts, apex ${tower.apex} m; Overture features at the tower: ${shownRows} visible, ${hiddenRows} hidden`);

// 2. Seeding joins a building's pieces across a z14 tile edge.
const javits = await js<{ parts: number; west: number; east: number; area: number }>(`
  const m = await seedAt(${JSON.stringify(Tag.Javits)}, ${JSON.stringify(JAVITS)});
  if (!m) return { parts: 0, west: 0, east: 0, area: 0 };
  const lngs = m.footprint.map((q) => q[0]), mid = ${JSON.stringify(JAVITS)}.lat, k = 111320 * Math.cos(mid * Math.PI / 180);
  const area = m.parts.reduce((s, p) => s + Math.abs(p.ring.reduce((a, q, i) => { const r = p.ring[(i + 1) % p.ring.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2, 0);
  return { parts: m.parts.length, west: (${TILE_EDGE_LNG} - Math.min(...lngs)) * k, east: (Math.max(...lngs) - ${TILE_EDGE_LNG}) * k, area };
`);
await js(`await drop(${JSON.stringify(Tag.Javits)}); return true;`);
check('seed spans z14 tiles', javits.parts > 0 && javits.west > 20 && javits.east > 20, `Javits: ${javits.parts} parts, ${javits.west.toFixed(0)} m west and ${javits.east.toFixed(0)} m east of the tile edge, ${javits.area.toFixed(0)} m² of parts`);

// 3. Closed solids, and an export round trip back to an editable Drawn model.
const closed = await js<{ open: number; tris: number; source: string; parts: boolean; warnings: string[]; plain: number }>(`
  const m = named(${JSON.stringify(TOWER_NAME)});
  const solid = mesh.partsMesh(m.parts);
  const out = S.models.getState().exportGlb(m.id);
  const imp = await share.importModelFile([{ name: out.fileName, arrayBuffer: async () => out.glb }]);
  const bare = await share.importModelFile([{ name: 'x.glb', arrayBuffer: async () => S.models.getState().exportGlb(m.id, false).glb }]);
  return { open: openEdges(solid.pos), tris: solid.idx.length / 3, source: imp.draft.source, parts: JSON.stringify(imp.draft.parts) === JSON.stringify(m.parts), warnings: [...imp.warnings, ...bare.warnings], plain: bare.stats.triangles };
`);
check('mesh closed; export → import stays Drawn', closed.open === 0 && closed.source === 'Drawn' && closed.parts && closed.warnings.length === 0 && closed.plain === closed.tris, `${closed.open} open edges over ${closed.tris} tris; import ${closed.source}, parts ${closed.parts ? 'equal' : 'differ'}; parts-free GLB ${closed.plain} tris; warnings ${JSON.stringify(closed.warnings)}`);

// 4a. Map: the selected outline hides behind the towers in front of it.
const lineShare = async (tag: string, view: string) => {
  await js(`map().jumpTo(${view}); await idle(); return true;`);
  await settle(800);
  const c = await js<{ x: number; y: number; width: number; height: number }>('return canvas();');
  const on = await tab.shot(`${shots}/${tag}-line-on.png`, c);
  await js(`map().setLayoutProperty('models-line', 'visibility', 'none'); await idle(); return true;`);
  await settle(500);
  const off = await tab.shot(`${shots}/${tag}-line-off.png`, c);
  await js(`map().setLayoutProperty('models-line', 'visibility', 'visible'); await idle(); return true;`);
  return js<number>(`return diff(${JSON.stringify(on)}, ${JSON.stringify(off)});`);
};
const mapOutline = async (tag: string) => {
  // No current part: an accent outline over the accent current-part fill is below the diff tolerance.
  await js(`const m = await block(${JSON.stringify(Tag.Lawn)}, ${JSON.stringify(LAWN)}, 30, 10); S.models.getState().select(m.id); S.models.getState().selectPart(null); return true;`);
  const clear = await lineShare(`${tag}-top`, `{ center: ${JSON.stringify(LAWN)}, zoom: 19, pitch: 0, bearing: 0 }`);
  const behind = await lineShare(`${tag}-behind`, `{ center: { lng: ${LAWN.lng}, lat: ${LAWN.lat - 0.0012} }, zoom: 17.5, pitch: 75, bearing: 0 }`);
  return { clear, behind };
};
const desk = await mapOutline('map');
check('map outline: drawn in the open, hidden behind towers', desk.clear > 0.0005 && desk.behind < 0.0002, `outline pixels ${(desk.clear * 100).toFixed(3)} % top-down, ${(desk.behind * 100).toFixed(4)} % behind 40th Street`);

// 4b. Viewfinder: a block right behind the tower draws no outline, one in the open draws it.
const viewfinder = async (camera: string, t: string, f: number) => {
  await tab.navigate(`${BASE}/viewfinder?camera=${camera}&target=${TOWER.lat},${TOWER.lng}&f=${f}&t=${t}`);
  await tab.until('!!window.__scape?.prism?.cam', 60_000);
  await js('S.world.getState().setPinHeight(0); return true;');
};
const drawn = async (focal: number, landscape: boolean) => {
  const ok = await tab.until(`(() => { const p = window.__scape?.prism; return p && p.cam && Math.abs(p.cam.focalMm - ${focal}) < 1e-6 && (p.cam.frameWmm > p.cam.frameHmm) === ${landscape} && p.terrain; })()`, 60_000, 300);
  if (!ok) throw new Error(`no ${focal} mm frame within 60 s`);
  await tab.until(`!window.__scape.buildings.getState().busy`, 30_000, 300);
  await settle();
};
/** Selects a model, aims at share f of its height and returns the outline segments drawn. */
const outline = async (name: string, f: number, focal: number, landscape: boolean) => {
  const id = await js<string>(`
    const m = named(${JSON.stringify(name)});
    S.models.getState().select(m.id);
    S.composition.getState().update({ focalMm: ${focal}, orientation: '${landscape ? 'Landscape' : 'Portrait'}' });
    const a = aimAt(m, ${f});
    S.composition.getState().aim(a.az, a.alt);
    return m.id;
  `);
  await drawn(focal, landscape);
  await tab.until(`window.__scape.modelOutline?.id === ${JSON.stringify(id)}`, 10_000, 200);
  return js<number>('return S.modelOutline.segments;');
};

await viewfinder(HOBOKEN, TIMES.day, 200);
await drawn(200, true);
await js(`
  const pin = S.world.getState().pin, t = named(${JSON.stringify(TOWER_NAME)}), c = centre(t);
  await block(${JSON.stringify(Tag.Hidden)}, geo.destination(pin, geo.bearingDeg(pin, c), geo.distanceM(pin, c) + 150), 20, 10);
  await block(${JSON.stringify(Tag.Clear)}, geo.destination(pin, 78, 800), 30, 60);
  return true;
`);
const matrix: string[] = [];
let matrixOk = true;
for (const light of Object.values(Light)) {
  await viewfinder(HOBOKEN, TIMES[light], 24);
  for (const landscape of [true, false]) {
    for (const f of [24, 200, 600, 2400]) {
      const hidden = await outline(Tag.Hidden, 0.5, f, landscape);
      const clear = await outline(Tag.Clear, 1, f, landscape);
      const name = `${light}-${landscape ? 'L' : 'P'}-${f}`;
      await tab.shot(`${shots}/${name}.png`, await js('return frame();'));
      const ok = hidden === 0 && clear > 0;
      matrixOk &&= ok;
      matrix.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | behind the tower ${hidden} segments, in the open ${clear} |`);
    }
  }
}
check('viewfinder outline: hidden behind a building, drawn in the open', matrixOk, `${matrix.length} frames`);

// A taller block behind the tower loses its lower part to the tower.
await js(`const h = named(${JSON.stringify(Tag.Hidden)}); await S.models.getState().update(h.id, { parts: h.parts.map((p) => ({ ...p, heightM: 600 })) }); return true;`);
const peekSegs = await outline(Tag.Hidden, 0.6, 200, true);
const peekBox = await js<{ y1: number; baseY: number } | null>(`
  const b = S.modelOutline.box, cam = S.prism.cam, a = aimAt(named(${JSON.stringify(Tag.Hidden)}), 0);
  const { cameraBasis, project } = await import('/src/lib/core/optics/projection.ts');
  const s = project(cam, cameraBasis(cam), a.az, a.alt);
  return b && s ? { y1: b.y1, baseY: Math.min(cam.frame.y + cam.frame.h, cam.frame.y + cam.frame.h / 2 - s.y * cam.frame.pxPerMm) } : null;
`);
await tab.shot(`${shots}/peek-above-crown.png`, await js('return frame();'));
await js(`const h = named(${JSON.stringify(Tag.Hidden)}); await S.models.getState().update(h.id, { parts: h.parts.map((p) => ({ ...p, heightM: 10 })) }); return true;`);
check('outline cut where the tower is in front', peekSegs > 0 && peekBox != null && peekBox.y1 < peekBox.baseY - 50, `600 m block: ${peekSegs} segments, outline bottom y ${peekBox?.y1.toFixed(0)} px vs its base ${peekBox?.baseY.toFixed(0)} px`);

// Terrain: First Watchung Mountain hides the tower's outline.
await viewfinder(RIDGE, TIMES.day, 200);
await js('S.world.getState().setPinHeight(40); return true;');
const ridge = await outline(TOWER_NAME, 0.5, 200, true);
await settle(3000);
const ridgeLate = await js<number>('return S.modelOutline.segments;');
await tab.shot(`${shots}/ridge.png`, await js('return frame();'));
check('viewfinder outline hidden behind a ridge', ridge === 0 && ridgeLate === 0, `${ridge} → ${ridgeLate} segments behind First Watchung`);

// Phone.
await tab.viewport(PHONE.w, PHONE.h);
await viewfinder(HOBOKEN, TIMES.day, 200);
const phoneHidden = await outline(Tag.Hidden, 0.5, 200, false);
const phoneClear = await outline(Tag.Clear, 1, 200, false);
await tab.shot(`${shots}/phone-viewfinder.png`);
await home();
const phoneMap = await mapOutline('phone');
check(`phone ${PHONE.w}×${PHONE.h}`, phoneHidden === 0 && phoneClear > 0 && phoneMap.clear > 0.0005 && phoneMap.behind < 0.0002, `viewfinder ${phoneHidden}/${phoneClear} segments hidden/open; map outline ${(phoneMap.clear * 100).toFixed(3)} % top-down, ${(phoneMap.behind * 100).toFixed(4)} % behind`);

await tab.viewport(1280, 800);
await js(`for (const n of ${JSON.stringify([TOWER_NAME, ...Object.values(Tag)])}) await drop(n); return true;`);
tab.close();
console.log('| Check | Result | Numbers |\n| --- | --- | --- |');
console.log(rows.join('\n'));
console.log('\n| Frame | Result | Numbers |\n| --- | --- | --- |');
console.log(matrix.join('\n'));
process.exit(failed ? 1 : 0);
