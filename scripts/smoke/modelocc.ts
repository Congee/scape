// Model occlusion smoke: on the map another model or a building in front hides the selected outline and dims its handles; the viewfinder agrees.
/* oxlint-disable no-await-in-loop -- smoke steps run one frame at a time */
// Usage: bun scripts/smoke/modelocc.ts <cdp> <dev-port> <shot-dir>
import { Tab } from './cdp';

const [cdp = '9600', port = '5600', shots = '/tmp/modelocc'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
// Central Park's Great Lawn: open ground, no Overture buildings near.
const GREAT_LAWN = { lat: 40.7812, lng: -73.9665 };
// Bryant Park's lawn, with 40th Street's towers south of it.
const BRYANT = { lat: 40.7536, lng: -73.9837 };
const Tag = { Selected: 'modelocc selected', Other: 'modelocc other', Bryant: 'modelocc bryant' } as const;
const PHONE = { w: 390, h: 844 };
/** Metres south of the selected block the other one stands: in front of a camera looking north, or behind it. */
const Other = { Front: -70, Behind: 110 } as const;

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
const north = (dM: number, at = GREAT_LAWN) => js<{ lng: number; lat: number }>(`return geo.destination(${JSON.stringify(at)}, 0, ${dM});`);

/** Share of map pixels the selected model adds, and the selected part's handles MapLibre dims. */
const probe = async (tag: string, view: string) => {
  await js(`map().jumpTo(${view}); await idle(); return true;`);
  await settle(800);
  const c = await js<{ x: number; y: number; width: number; height: number }>('return canvas();');
  const on = await tab.shot(`${shots}/${tag}-line-on.png`, c);
  const dimmed = await js<number>(`return [...document.querySelectorAll('.map-vertex')].filter((e) => e.style.opacity === '0.2').length;`);
  const handles = await js<number>(`return document.querySelectorAll('.map-vertex').length;`);
  await js(`for (const l of ['models-fill', 'models-line']) map().setLayoutProperty(l, 'visibility', 'none'); await idle(); return true;`);
  await settle(500);
  const off = await tab.shot(`${shots}/${tag}-line-off.png`, c);
  await js(`for (const l of ['models-fill', 'models-line']) map().setLayoutProperty(l, 'visibility', 'visible'); await idle(); return true;`);
  return { line: await js<number>(`return diff(${JSON.stringify(on)}, ${JSON.stringify(off)});`), dimmed, handles };
};
const pct = (x: number) => `${(x * 100).toFixed(4)} %`;

/** A 30 m, 10 m block selected on the Great Lawn, and an 80 m, 60 m block south (in front) or north (behind) of it, or hidden. */
const modelsCase = async (tag: string) => {
  await js(`
    S.settings.getState().update({ showBuildings: false });
    const a = await block(${JSON.stringify(Tag.Selected)}, ${JSON.stringify(GREAT_LAWN)}, 30, 10);
    await block(${JSON.stringify(Tag.Other)}, ${JSON.stringify(await north(Other.Front))}, 80, 60);
    S.models.getState().select(a.id);
    return true;
  `);
  const view = `{ center: ${JSON.stringify(await north(-130))}, zoom: 17.5, pitch: 75, bearing: 0 }`;
  const front = await probe(`${tag}-front`, view);
  await js(`await S.models.getState().update(named(${JSON.stringify(Tag.Other)}).id, { visible: false }); return true;`);
  const alone = await probe(`${tag}-alone`, view);
  const behindAt = await north(Other.Behind);
  await js(`await block(${JSON.stringify(Tag.Other)}, ${JSON.stringify(behindAt)}, 80, 60); S.models.getState().select(named(${JSON.stringify(Tag.Selected)}).id); return true;`);
  const behind = await probe(`${tag}-behind`, view);
  return { front, alone, behind };
};
const modelsOk = (r: Awaited<ReturnType<typeof modelsCase>>) =>
  r.front.line < 0.0002 && r.alone.line > 0.0001 && r.behind.line > r.alone.line * 0.7 && r.front.handles === 4 && r.front.dimmed === 4 && r.alone.dimmed === 0 && r.behind.dimmed === 0;
const modelsDetail = (r: Awaited<ReturnType<typeof modelsCase>>) =>
  `selected model ${pct(r.front.line)} behind the other model, ${pct(r.alone.line)} alone, ${pct(r.behind.line)} with it behind; handles dimmed ${r.front.dimmed}/${r.front.handles}, ${r.alone.dimmed}, ${r.behind.dimmed}`;

/** The selected block on Bryant Park's lawn, top-down and seen past 40th Street's towers. */
const buildingsCase = async (tag: string) => {
  await js(`
    S.settings.getState().update({ showBuildings: true });
    await drop(${JSON.stringify(Tag.Other)});
    const m = await block(${JSON.stringify(Tag.Bryant)}, ${JSON.stringify(BRYANT)}, 30, 10);
    S.models.getState().select(m.id);
    return true;
  `);
  const top = await probe(`${tag}-bryant-top`, `{ center: ${JSON.stringify(BRYANT)}, zoom: 19, pitch: 0, bearing: 0 }`);
  const behind = await probe(`${tag}-bryant-behind`, `{ center: { lng: ${BRYANT.lng}, lat: ${BRYANT.lat - 0.0012} }, zoom: 17.5, pitch: 75, bearing: 0 }`);
  return { top, behind };
};
const bldOk = (r: Awaited<ReturnType<typeof buildingsCase>>) => r.top.line > 0.0005 && r.top.dimmed === 0 && r.behind.line < 0.0002 && r.behind.dimmed === r.behind.handles && r.behind.handles === 4;
const bldDetail = (r: Awaited<ReturnType<typeof buildingsCase>>) => `selected model ${pct(r.top.line)} top-down, ${pct(r.behind.line)} behind towers; handles dimmed ${r.top.dimmed}/${r.top.handles} top-down, ${r.behind.dimmed}/${r.behind.handles} behind`;

await home();
const renderer = await Tab.renderer(Number(cdp));
check('renderer is ANGLE Metal', /ANGLE Metal/.test(renderer), renderer);
const settingsApi = await js<boolean>('return typeof S.settings.getState().update === "function";');
check('settings store has update()', settingsApi, 'toggles buildings off for the models-only case');

const desk = await modelsCase('map');
check('map: another model in front hides the outline and dims handles', modelsOk(desk), modelsDetail(desk));

// Still map with handles up: no frames while idle.
const quiet = async () => {
  let best = Infinity;
  for (let i = 0; i < 3 && best > 0; i++) {
    await js('S.idle.reset(); return true;');
    await Bun.sleep(3000);
    best = Math.min(best, await js<number>('return S.idle.raf;'));
  }
  return best;
};
const idleRaf = await quiet();
check('idle with handles up', idleRaf === 0, `${idleRaf} rAF callbacks in 3 s`);

const bld = await buildingsCase('map');
check('map: buildings in front hide the outline and dim handles', bldOk(bld), bldDetail(bld));

// Viewfinder parity: a model in front of the selected one hides its outline there too.
await js(`
  await drop(${JSON.stringify(Tag.Bryant)});
  S.settings.getState().update({ showBuildings: true });
  const a = await block(${JSON.stringify(Tag.Selected)}, ${JSON.stringify(GREAT_LAWN)}, 30, 10);
  await block(${JSON.stringify(Tag.Other)}, ${JSON.stringify(await north(Other.Front))}, 80, 60);
  S.models.getState().select(a.id);
  return true;
`);
const cam = await north(-600);
await tab.navigate(`${BASE}/viewfinder?camera=${cam.lat},${cam.lng}&target=${GREAT_LAWN.lat},${GREAT_LAWN.lng}&f=200&t=2026-09-24T20:30Z`);
await tab.until('!!window.__scape?.prism?.cam && !!window.__scape.prism.terrain', 60_000, 300);
await js('S.world.getState().setPinHeight(20); return true;');
const vfSegs = async () => {
  const id = await js<string>(`
    const m = named(${JSON.stringify(Tag.Selected)});
    S.models.getState().select(null); S.models.getState().select(m.id);
    const a = aimAt(m, 0.5);
    S.composition.getState().aim(a.az, a.alt);
    return m.id;
  `);
  await tab.until(`!window.__scape.buildings.getState().busy`, 30_000, 300);
  await settle(2000);
  await tab.until(`window.__scape.modelOutline?.id === ${JSON.stringify(id)}`, 10_000, 200);
  return js<number>('return S.modelOutline.segments;');
};
const vfFront = await vfSegs();
await tab.shot(`${shots}/vf-front.png`, await js('return frame();'));
await js(`await S.models.getState().update(named(${JSON.stringify(Tag.Other)}).id, { visible: false }); return true;`);
const vfAlone = await vfSegs();
await tab.shot(`${shots}/vf-alone.png`, await js('return frame();'));
check('viewfinder agrees', vfFront === 0 && vfAlone > 0, `outline segments ${vfFront} behind the other model, ${vfAlone} alone`);

// Phone.
await tab.viewport(PHONE.w, PHONE.h);
await home();
const phone = await modelsCase('phone');
const phoneBld = await buildingsCase('phone');
await tab.shot(`${shots}/phone-map.png`);
check(`phone ${PHONE.w}×${PHONE.h}`, modelsOk(phone) && bldOk(phoneBld), `${modelsDetail(phone)}; ${bldDetail(phoneBld)}`);

await tab.viewport(1280, 800);
await js(`for (const n of ${JSON.stringify(Object.values(Tag))}) await drop(n); S.settings.getState().update({ showBuildings: true }); return true;`);
tab.close();
console.log('| Check | Result | Numbers |\n| --- | --- | --- |');
console.log(rows.join('\n'));
process.exit(failed ? 1 : 0);
