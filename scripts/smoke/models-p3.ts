// Precise models P3 smoke: GLB import through the sheet, placement on a building, suppression, shadows, nudges, export round trip, Draco refusal, phone sheet.
/* oxlint-disable no-await-in-loop -- smoke steps run one frame at a time */
// Usage: bun scripts/smoke/models-p3.ts <cdp> <dev-port> <shot-dir>
import { Tab } from './cdp';

const [cdp = '9343', port = '5330', shots = '/tmp/models-p3'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const TOWER = { lat: 40.754, lng: -74.0008 };
const HOBOKEN = '40.7527,-74.0225';
const APEX_M = 380;
const SPIRE = `${shots}/spire-tower.glb`;
const DRACO = `${shots}/draco-tower.glb`;
const EXPORTED = `${shots}/exported.glb`;
const Light = { Day: 'day', Night: 'night' } as const;
type Light = (typeof Light)[keyof typeof Light];
const TIMES: Record<Light, string> = { day: '2026-09-24T20:30Z', night: '2026-09-25T03:00Z' };
const PHONE = { w: 390, h: 844 };
const DESKTOP = { w: 1280, h: 800 };

type Box = { x: number; y: number; width: number; height: number };
type Placed = { id: string; source: string; anchor: Record<string, number | string>; footprint: [number, number][]; glbBytes: number; name: string };

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
await tab.activate();

const HELPERS = `(async () => {
  if (window.__smoke) return true;
  // The URL the app loaded, which after HMR carries a ?t= stamp; a bare import would make a second store.
  const imp = (path) => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === path) ?? path);
  const [buildings, geo, ui, core, gltf] = await Promise.all(['state/buildings', 'core/geo/geodesy', 'state/ui', 'core/model', 'core/model/gltf'].map((m) => imp('/src/lib/' + m + '.ts')));
  const S = window.__scape;
  const byId = (id) => S.models.getState().models.find((m) => m.id === id) ?? null;
  const placed = (m) => m && { id: m.id, source: m.source, anchor: m.anchor, footprint: m.footprint, glbBytes: m.glb?.byteLength ?? 0, name: m.name };
  const map = () => window.__scapeMap;
  const idle = async () => { const m = map(); m.triggerRepaint(); return new Promise((r) => { const t = setTimeout(() => r(false), 20000); m.once('idle', () => { clearTimeout(t); r(true); }); }); };
  const frame = () => {
    const r = document.querySelector('.vf-gl').getBoundingClientRect(), f = S.prism.cam.frame;
    return { x: r.left + f.x, y: r.top + f.y, width: f.w, height: f.h };
  };
  /** Aims at the model's centre at a share of its apex. */
  const aimAt = (m, share) => {
    const pin = S.world.getState().pin, d = geo.distanceM(pin, m.anchor);
    S.composition.getState().aim(geo.bearingDeg(pin, m.anchor), Math.atan2(core.modelBaseM(m.anchor, m.groundM) + ${APEX_M} * m.anchor.scale * share - S.prism.cam.eyeM - geo.curvatureDropM(d), d) * 180 / Math.PI);
  };
  window.__smoke = { buildings, geo, ui, core, gltf, byId, placed, map, idle, frame, aimAt };
  return true;
})()`;

const js = <T = unknown>(body: string, timeoutMs = 60_000) =>
  tab.eval<T>(`(async () => { await ${HELPERS}; const { buildings, geo, ui, core, gltf, byId, placed, map, idle, frame, aimAt } = window.__smoke; const S = window.__scape; ${body} })()`, timeoutMs);
const settle = (ms = 1500) => Bun.sleep(ms);
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
const openModels = () => js(`ui.uiStore.getState().setPanelTab('Markers'); ui.uiStore.getState().setMarkersView('Models'); return true;`);
const home = async () => {
  await tab.navigate(`${BASE}/`);
  await tab.until('!!window.__scape?.models?.getState().loaded && !!window.__scapeMap', 60_000);
};
const upload = async (files: string[]) => {
  await tab.until(`!!document.querySelector('input.model-file')`, 10_000, 100);
  const { root } = (await tab.send('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } };
  const { nodeId } = (await tab.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input.model-file' })) as { nodeId: number };
  await tab.send('DOM.setFileInputFiles', { nodeId, files });
};
/** The sheet's stats once parsed, or its error. */
const sheet = () =>
  tab.until<{ stats: string | null; error: string | null }>(
    `(() => { const s = document.querySelector('[data-testid="import-stats"]'), e = document.querySelector('[data-testid="import-error"]'); return (s || e) && { stats: s?.innerText.replace(/\\s+/g, ' ') ?? null, error: e?.textContent ?? null }; })()`,
    10_000,
    100
  );
/** Clicks Place and waits for the selected new model. */
const place = async (before: number) => {
  await click('Place', '.model-import');
  return tab.until<Placed>(
    `(() => { const s = window.__scape.models.getState(); if (document.querySelector('.model-import') || s.models.length <= ${before}) return null; const m = s.models.find((m) => m.id === s.selectedId); return m && window.__smoke.placed(m); })()`,
    15_000,
    200
  );
};
const count = () => js<number>('return S.models.getState().models.length;');
const drawn = async (focal: number, orient: string) => {
  const ok = await tab.until(`(() => { const p = window.__scape?.prism; return p && p.cam && Math.abs(p.cam.focalMm - ${focal}) < 1e-6 && (p.cam.frameWmm > p.cam.frameHmm) === ${orient === 'Landscape'} && p.terrain; })()`, 60_000, 300);
  if (!ok) throw new Error(`no ${focal} mm ${orient} frame within 60 s`);
  await tab.until(`!window.__scape.buildings.getState().busy`, 30_000, 300);
  await settle();
};
const viewfinder = async (t: string, f: number) => {
  await tab.navigate(`${BASE}/viewfinder?camera=${HOBOKEN}&target=${TOWER.lat},${TOWER.lng}&f=${f}&t=${t}`);
  await tab.until('!!window.__scape?.prism?.cam', 60_000);
  await js('S.world.getState().setPinHeight(0); return true;');
};
const ours = new Set<string>();

// Renderer.
await tab.viewport(DESKTOP.w, DESKTOP.h);
await home();
const renderer = await tab.eval<string>(`(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); })()`);
check('renderer is ANGLE Metal', /ANGLE Metal/.test(renderer), renderer);
await js(`for (const m of S.models.getState().models.filter((m) => m.name === 'spire-tower' || m.name === 'exported')) await S.models.getState().remove(m.id); return true;`);

// Import through the sheet and stand it on the tower picked on the map.
await js(`map().jumpTo({ center: [${TOWER.lng}, ${TOWER.lat}], zoom: 17, pitch: 0, bearing: 0 }); await idle(); return true;`);
await openModels();
let n0 = await count();
await upload([SPIRE]);
const s1 = await sheet();
await tab.shot(`${shots}/sheet-desktop.png`);
const statsOk = !!s1?.stats && /Vertices 13\b/.test(s1.stats) && /Triangles 16\b/.test(s1.stats) && /Height 380(\.0)? m/.test(s1.stats) && /40\.0 m × 40\.0 m/.test(s1.stats) && /Degenerate 1 dropped/.test(s1.stats);
check('sheet shows stats before placing', statsOk, s1?.stats ?? s1?.error ?? 'no sheet');
await click('On a building', '.model-import');
const at = await js<{ x: number; y: number }>(`const p = map().project([${TOWER.lng}, ${TOWER.lat}]), r = map().getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y };`);
await tap(at.x, at.y);
const picked = await tab.until<string>(`(() => { const t = document.querySelector('[data-testid="import-stats"]')?.innerText ?? ''; return /picked building/.test(t) && t; })()`, 15_000, 200);
const tower = await place(n0);
if (tower) ours.add(tower.id);
const off = tower ? await js<number>(`return geo.distanceM(${JSON.stringify(TOWER)}, byId(${JSON.stringify(tower.id)}).anchor);`) : Infinity;
await settle(800);
await tab.shot(`${shots}/placed-desktop.png`);
check(
  'placed on the picked Overture building',
  !!picked && !!tower && tower.source === 'Imported' && tower.footprint.length === 4 && off < 60,
  tower ? `${tower.source}, ${tower.footprint.length}-corner footprint, anchor ${off.toFixed(1)} m from 30 Hudson Yards` : 'nothing placed'
);
if (!tower) throw new Error('no imported model to test');
const TID = JSON.stringify(tower.id);

// Overture rows under the footprint leave the map and the viewfinder.
// Other smokes' towers stand here too; they stop suppressing for the check.
const others = await js<string[]>(
  `const ids = S.models.getState().models.filter((m) => m.id !== ${TID} && m.suppressOverture && geo.distanceM(m.anchor, ${JSON.stringify(TOWER)}) < 500).map((m) => m.id); for (const id of ids) await S.models.getState().update(id, { suppressOverture: false }); return ids;`
);
const ids = await js<number>(`await new Promise((r) => setTimeout(r, 2500)); return ((await buildings.suppressedBuildingIds()) ?? []).length;`);
await viewfinder(TIMES.day, 24);
await drawn(24, 'Landscape');
const suppressCount = async (on: boolean) => {
  await js(`await S.models.getState().update(${TID}, { suppressOverture: ${on} }); return true;`);
  await settle(3000);
  return js<number>('return S.prism.buildings;');
};
const kept = await suppressCount(false);
const dropped = await suppressCount(true);
await js(`for (const id of ${JSON.stringify(others)}) await S.models.getState().update(id, { suppressOverture: true }); return true;`);
check('Overture rows under the footprint suppressed', ids > 0 && kept > dropped, `${ids} suppressed ids on the map (${others.length} other models paused); ${kept} → ${dropped} buildings in the viewfinder`);

// The matrix: drawn, and casting only by day.
const matrix: string[] = [];
let matrixOk = true;
await js(`S.settings.getState().update({ lightSource: 'Auto' }); return true;`);
for (const light of Object.values(Light)) {
  await viewfinder(TIMES[light], 24);
  for (const orient of ['Landscape', 'Portrait']) {
    for (const f of [24, 200, 600, 2400]) {
      await js(`S.composition.getState().update({ focalMm: ${f}, orientation: '${orient}' }); aimAt(byId(${TID}), ${f > 200 ? 0.9 : 0.5}); return true;`);
      await drawn(f, orient);
      const p = await js<{ models: number; tris: number; shadow: number; body: string | null; sun: number; fr: Box }>('const p = S.prism; return { models: p.models, tris: p.modelTris, shadow: p.shadow.casterModelTris, body: p.shadow.light, sun: p.cam.sunAlt, fr: frame() };');
      // Auto light: the sun by day, the 97 % moon (42° up) at night.
      const shadowOk = p.body === (light === Light.Night ? 'Moon' : 'Sun') && p.shadow > 0;
      const ok = p.models >= 1 && p.tris > 0 && shadowOk;
      matrixOk &&= ok;
      const name = `${light}-${orient[0]}-${f}`;
      await tab.shot(`${shots}/${name}.png`, p.fr);
      matrix.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | models ${p.models}, tris ${p.tris}, shadowModelTriangles ${p.shadow}, light ${p.body}, sun ${p.sun.toFixed(1)}° |`);
    }
  }
}
check('matrix: drawn at every focal, sun-lit by day, moon-lit at night', matrixOk, `${matrix.length} frames`);

// Sun-only light at night: no light, so no shadow pass at all.
await js(`S.settings.getState().update({ lightSource: 'Sun' }); S.composition.getState().update({ focalMm: 200, orientation: 'Landscape' }); aimAt(byId(${TID}), 0.5); return true;`);
await drawn(200, 'Landscape');
const dark = await js<{ light: string | null; cascades: number; tris: number }>('const s = S.prism.shadow; return { light: s.light, cascades: s.cascades, tris: s.casterTris };');
await js(`S.settings.getState().update({ lightSource: 'Auto' }); return true;`);
check('no shadow pass when no body lights the night', dark.light === null && dark.cascades === 0 && dark.tris === 0, `light ${dark.light}, cascades ${dark.cascades}, caster tris ${dark.tris}`);

// Nudges re-derive the footprint, and the map's extrusion follows it.
await home();
await js(`S.models.getState().select(${TID}); map().jumpTo({ center: [${TOWER.lng}, ${TOWER.lat}], zoom: 17, pitch: 0, bearing: 0 }); await idle(); return true;`);
await openModels();
await tab.until(`!!document.querySelector('.model-editor .nudge-pad')`, 10_000);
const ring = () =>
  js<{ fp: [number, number][]; onMap: [number, number][] | null; anchor: { lat: number; lng: number; headingDeg: number } }>(`
  await idle();
  const m = byId(${TID});
  // The source's data, since rendered tiles clip and quantise rings.
  const f = (await map().getSource('models').getData()).features.find((f) => f.properties.model === m.id);
  return { fp: m.footprint, onMap: f ? f.geometry.coordinates[0].slice(0, -1) : null, anchor: m.anchor };
`);
const r0 = await ring();
await click('East +1 m', '.nudge-pad');
await tab.until(`window.__scape.models.getState().models.find((m) => m.id === ${TID}).footprint[0][0] !== ${r0.fp[0][0]}`, 5000, 100);
const r1 = await ring();
await click('Heading +1 °', '.nudge-pad');
await tab.until(`window.__scape.models.getState().models.find((m) => m.id === ${TID}).anchor.headingDeg !== ${r1.anchor.headingDeg}`, 5000, 100);
const r2 = await ring();
await tab.shot(`${shots}/nudged-desktop.png`);
const moves = await js<{ east: number[]; north: number[]; turn: number[]; mapOff: number }>(`
  const a0 = ${JSON.stringify(r0.anchor)}, a1 = ${JSON.stringify(r1.anchor)}, a2 = ${JSON.stringify(r2.anchor)};
  const fr = (a, fp) => fp.map(([lng, lat]) => core.lngLatToLocal({ ...a0, headingDeg: 0, scale: 1 }, { lng, lat }));
  const p0 = fr(a0, ${JSON.stringify(r0.fp)}), p1 = fr(a0, ${JSON.stringify(r1.fp)});
  const b = (a, fp) => fp.map(([lng, lat]) => geo.bearingDeg(a, { lng, lat })).sort((x, y) => x - y);
  const t1 = b(a1, ${JSON.stringify(r1.fp)}), t2 = b(a2, ${JSON.stringify(r2.fp)});
  const onMap = ${JSON.stringify(r2.onMap)}, fp2 = ${JSON.stringify(r2.fp)};
  const mapOff = onMap ? Math.max(...fp2.map(([lng, lat]) => Math.min(...onMap.map(([x, y]) => geo.distanceM({ lng, lat }, { lng: x, lat: y }))))) : Infinity;
  return { east: p1.map((p, i) => p[0] - p0[i][0]), north: p1.map((p, i) => p[1] - p0[i][1]), turn: t2.map((v, i) => v - t1[i]), mapOff };
`);
const eastOk = moves.east.every((d) => Math.abs(d - 1) < 0.01) && moves.north.every((d) => Math.abs(d) < 0.01);
const turnOk = moves.turn.every((d) => Math.abs(d - 1) < 0.01);
check(
  'nudges move the footprint, and the map follows',
  eastOk && turnOk && moves.mapOff < 0.05,
  `East +1 m: e ${moves.east.map((d) => d.toFixed(3)).join('/')} n ${moves.north.map((d) => d.toFixed(3)).join('/')}; Heading +1°: ${moves.turn.map((d) => d.toFixed(3)).join('/')}°; map ring off ${moves.mapOff.toFixed(3)} m`
);

// Export through the button and a Blob URL, then import the file back.
await js(`
  window.__download = null;
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.download || !this.href.startsWith('blob:')) return click.call(this);
    window.__download = fetch(this.href).then((r) => r.arrayBuffer()).then((b) => ({ name: this.download, b64: btoa(String.fromCharCode(...new Uint8Array(b))) }));
  };
  return true;
`);
await click('Export GLB', '.model-editor');
const dl = await js<{ name: string; b64: string } | null>('return window.__download ? await window.__download : null;');
const src = await js<Placed>(`return placed(byId(${TID}));`);
let back: Placed | null = null;
if (dl) {
  await Bun.write(EXPORTED, Buffer.from(dl.b64, 'base64'));
  n0 = await count();
  await upload([EXPORTED]);
  const s2 = await sheet();
  check('exported file places where it says', !!s2?.stats && s2.stats.trim().endsWith('where the file says'), s2?.stats ?? s2?.error ?? 'no sheet');
  back = await place(n0);
  if (back) ours.add(back.id);
}
const same = !!back && JSON.stringify(back.anchor) === JSON.stringify(src.anchor) && JSON.stringify(back.footprint) === JSON.stringify(src.footprint);
check(
  'export → re-import keeps anchor and footprint byte-identical',
  same,
  dl ? `${dl.name} ${Buffer.from(dl.b64, 'base64').length} B → ${back ? `${back.source}, anchor ${same ? '=' : '≠'}, footprint ${JSON.stringify(back.footprint) === JSON.stringify(src.footprint) ? '=' : '≠'}` : 'not placed'}` : 'no download'
);

await tab.reload();
await tab.until('!!window.__scape?.models?.getState().loaded', 60_000);
const kept2 = await js<(Placed | null)[]>(`return [${TID}, ${JSON.stringify(back?.id ?? '')}].map((id) => placed(byId(id)));`);
const persistOk = !!kept2[0] && !!kept2[1] && JSON.stringify(kept2[1].footprint) === JSON.stringify(src.footprint) && JSON.stringify(kept2[0].anchor) === JSON.stringify(src.anchor) && kept2[1].glbBytes > 0;
check('imported models persist across reload', persistOk, kept2.map((m) => (m ? `${m.source} ${m.glbBytes} B` : 'missing')).join(', '));

// Draco: the design doc's message, and nothing placed.
await openModels();
n0 = await count();
await upload([DRACO]);
const s3 = await sheet();
const want = await js<string>('return gltf.COMPRESSED_MESSAGE;');
await settle(300);
const placeOff = await tab.eval<boolean>(`[...document.querySelectorAll('.model-import button')].find((b) => b.textContent.trim() === 'Place')?.disabled ?? false`);
await tab.shot(`${shots}/draco-desktop.png`);
await click('Place', '.model-import');
await settle(500);
const n1 = await count();
await click('Cancel', '.model-import');
check('Draco file refused with the design text', s3?.error === want && placeOff && n1 === n0, `"${s3?.error ?? s3?.stats}"; Place ${placeOff ? 'disabled' : 'enabled'}; models ${n0} → ${n1}`);

// Phone: the sheet fits and places; touch emulation makes pointer: coarse match.
await tab.viewport(PHONE.w, PHONE.h);
await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await home();
await openModels();
n0 = await count();
await upload([SPIRE]);
const s4 = await sheet();
await tab.eval(`document.querySelector('.model-import .actions')?.scrollIntoView({ block: 'center' })`);
await settle(500);
const fit = await tab.eval<{ coarse: boolean; sheet: Box; overflow: number; buttons: { t: string; w: number; h: number; inView: boolean }[] }>(`(() => {
  const s = document.querySelector('.model-import').getBoundingClientRect();
  // Each control scrolled to, then hit-tested, since the tab bar overlays the panel's foot.
  const buttons = [...document.querySelectorAll('.model-import button, .model-import select')].map((b) => { b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { t: b.getAttribute('aria-label') || b.textContent.trim().slice(0, 16), w: r.width, h: r.height, inView: r.left >= 0 && r.right <= innerWidth && b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }; });
  return { coarse: matchMedia('(pointer: coarse)').matches, sheet: { x: s.left, y: s.top, width: s.width, height: s.height }, overflow: document.documentElement.scrollWidth - innerWidth, buttons };
})()`);
await tab.shot(`${shots}/sheet-phone.png`);
const phone = await place(n0);
if (phone) ours.add(phone.id);
await settle(500);
await tab.shot(`${shots}/placed-phone.png`);
const fitOk = !!s4?.stats && fit.sheet.x >= 0 && fit.sheet.x + fit.sheet.width <= PHONE.w && fit.overflow <= 0 && fit.buttons.every((b) => b.inView && b.h >= 36);
check(
  'phone import sheet usable at 390×844',
  fitOk && !!phone,
  `${fit.coarse ? 'coarse' : 'fine'} pointer, sheet ${fit.sheet.width.toFixed(0)}×${fit.sheet.height.toFixed(0)} at x ${fit.sheet.x.toFixed(0)}, overflow ${fit.overflow} px; ${fit.buttons.map((b) => `${b.t} ${b.h.toFixed(0)}px${b.inView ? '' : ' (off)'}`).join(', ')}; ${phone ? 'placed' : 'not placed'}`
);

await js(`for (const id of ${JSON.stringify([...ours])}) await S.models.getState().remove(id); return true;`);
await tab.send('Emulation.setTouchEmulationEnabled', { enabled: false });
await tab.send('Emulation.clearDeviceMetricsOverride', {});
await tab.navigate(`${BASE}/`);
tab.close();
console.log('| Check | Result | Numbers |\n| --- | --- | --- |');
console.log(rows.join('\n'));
console.log('\n| Frame | Result | Numbers |\n| --- | --- | --- |');
console.log(matrix.join('\n'));
process.exit(failed ? 1 : 0);
