// Precise models P1 smoke: Hoboken → 30 Hudson Yards, driven through CDP on the smoke's own tab.
/* oxlint-disable no-await-in-loop -- smoke steps run one frame at a time */
// Usage: bun scripts/smoke/models-p1.ts <cdp> <dev-port> <preview-port|-> <shot-dir>
import { Tab } from './cdp';

const [cdp = '9336', port = '5260', preview = '5261', shots = '/tmp/models-p1'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const NAME = '30 Hudson Yards';
const TOWER = { lat: 40.754, lng: -74.0008 };
// Hoboken's 14th Street pier: open water up to the Hudson Yards towers.
const HOBOKEN = '40.7527,-74.0225';
// West of First Watchung Mountain: the ridge stands between the camera and Manhattan.
const RIDGE = '40.787,-74.32';
const Light = { Day: 'day', Low: 'low', Night: 'night' } as const;
type Light = (typeof Light)[keyof typeof Light];
// Day: the sun at 245°, behind a camera facing 86°. Low: 5° up at 297°. Night: 23:00 EDT.
const TIMES: Record<Light, string> = { day: '2026-09-24T20:30Z', low: '2026-06-21T23:56Z', night: '2026-09-25T03:00Z' };
const Aim = { Top: 'top', Edge: 'edge' } as const;
type Aim = (typeof Aim)[keyof typeof Aim];

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
  const [models, buildings, seed, heightAt, geo, proj, ui, core] = await Promise.all(
    ['state/models', 'state/buildings', 'core/model/seed', 'core/model/heightAt', 'core/geo/geodesy', 'core/optics/projection', 'state/ui', 'core/model'].map((m) => imp('/src/lib/' + m + '.ts'))
  );
  const S = window.__scape;
  const model = () => window.__scape.models.getState().models.find((m) => m.name === ${JSON.stringify(NAME)}) ?? null;
  const apex = (m) => seed.modelApexM(m.parts);
  /** Bearing, distance and crown altitude through the tallest part's centre; the anchor can sit beside it. */
  const crown = async () => {
    const m = model(), pin = S.world.getState().pin, top = m.parts.reduce((b, p, i) => (p.heightM > m.parts[b].heightM ? i : b), 0);
    const ring = core.modelOutlines({ ...m, parts: [m.parts[top]] })[0];
    const c = { lng: ring.reduce((a, q) => a + q[0], 0) / ring.length, lat: ring.reduce((a, q) => a + q[1], 0) / ring.length };
    const d = geo.distanceM(pin, c);
    return { az: geo.bearingDeg(pin, c), d, alt: Math.atan2(m.groundM + apex(m) - S.prism.cam.eyeM - geo.curvatureDropM(d), d) * 180 / Math.PI };
  };
  /** CSS-pixel box of the model in the page, from its outline at the ground and at the apex. */
  const box = () => {
    const m = model(), p = S.prism, cam = p.cam, pin = S.world.getState().pin, basis = proj.cameraBasis(cam);
    const r = document.querySelector('.vf-gl').getBoundingClientRect();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const g = Number.isNaN(m.groundM) ? 0 : Math.max(0, m.groundM);
    for (const [lng, lat] of m.footprint) for (const u of [g, g + apex(m)]) {
      const d = geo.distanceM(pin, { lng, lat });
      const alt = Math.atan2(u - cam.eyeM - geo.curvatureDropM(d), d) * 180 / Math.PI;
      const s = proj.project(cam, basis, geo.bearingDeg(pin, { lng, lat }), alt);
      if (!s) continue;
      const x = r.left + cam.frame.x + cam.frame.w / 2 + s.x * cam.frame.pxPerMm, y = r.top + cam.frame.y + cam.frame.h / 2 - s.y * cam.frame.pxPerMm;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const fx = r.left + cam.frame.x, fy = r.top + cam.frame.y;
    x0 = Math.max(x0, fx); y0 = Math.max(y0, fy); x1 = Math.min(x1, fx + cam.frame.w); y1 = Math.min(y1, fy + cam.frame.h);
    return x1 - x0 >= 2 && y1 - y0 >= 2 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  };
  const frame = () => {
    const r = document.querySelector('.vf-gl').getBoundingClientRect(), f = S.prism.cam.frame;
    return { x: r.left + f.x, y: r.top + f.y, width: f.w, height: f.h };
  };
  const decode = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => { const c = new OffscreenCanvas(i.width, i.height).getContext('2d'); c.drawImage(i, 0, 0); res(c.getImageData(0, 0, i.width, i.height).data); }; i.src = 'data:image/png;base64,' + b64; });
  /** Share of pixels whose largest channel change exceeds tol. */
  const diff = async (a, b, tol = 24) => {
    const [p, q] = await Promise.all([decode(a), decode(b)]);
    if (p.length !== q.length) return 1;
    let n = 0;
    for (let i = 0; i < p.length; i += 4) if (Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2])) > tol) n++;
    return n / (p.length / 4);
  };
  window.__smoke = { models, buildings, seed, heightAt, geo, ui, model, apex, crown, box, frame, diff };
  return true;
})()`;

const js = <T = unknown>(body: string, timeoutMs = 60_000) => tab.eval<T>(`(async () => { await ${HELPERS}; const { models, buildings, seed, geo, ui, model, apex, crown, box, frame, diff } = window.__smoke; const S = window.__scape; ${body} })()`, timeoutMs);
const settle = (ms = 1500) => Bun.sleep(ms);
/** Waits for a frame drawn with the wanted focal and orientation, then for tiles to land. */
const drawn = async (focal: number, orient: string) => {
  const ok = await tab.until(`(() => { const p = window.__scape?.prism; return p && p.cam && Math.abs(p.cam.focalMm - ${focal}) < 1e-6 && (p.cam.frameWmm > p.cam.frameHmm) === ${orient === 'Landscape'} && p.terrain; })()`, 60_000, 300);
  if (!ok) throw new Error(`no ${focal} mm ${orient} frame within 60 s`);
  await tab.until(`!window.__scape.buildings.getState().busy`, 30_000, 300);
  await settle();
};
const viewfinder = async (camera: string, t: string, f: number) => {
  await tab.navigate(`${BASE}/viewfinder?camera=${camera}&target=${TOWER.lat},${TOWER.lng}&f=${f}&t=${t}`);
  await tab.until('!!window.__scape?.prism?.cam', 60_000);
  await js('S.world.getState().setPinHeight(0); return true;');
};

// Renderer.
await tab.navigate(`${BASE}/`);
await tab.until('!!window.__scape?.models?.getState().loaded', 60_000);
const renderer = await tab.eval<string>(`(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); })()`);
check('renderer is ANGLE Metal', /ANGLE Metal/.test(renderer), renderer);

// Seed from the Overture rows under the tower.
const seeded = await js<{ parts: number; apex: number; heights: number[]; roofs: number[] }>(`
  for (const m of window.__scape.models.getState().models.filter((m) => m.name === ${JSON.stringify(NAME)})) await window.__scape.models.getState().remove(m.id);
  const rows = await buildings.buildingRowsAt(${JSON.stringify(TOWER)});
  const m = rows && seed.seedModel(rows, ${JSON.stringify(NAME)});
  if (!m) return { parts: 0, apex: 0, heights: [], roofs: [] };
  await window.__scape.models.getState().save(m);
  window.__scape.models.getState().select(m.id);
  return { parts: m.parts.length, apex: apex(m), heights: m.parts.map((p) => p.heightM), roofs: m.parts.map((p) => p.roof) };
`);
check('seed from Overture rows', seeded.parts >= 10 && seeded.apex === 395, `${seeded.parts} parts, apex ${seeded.apex} m, tops ${seeded.heights.join('/')}`);

// Target height from the typed apex, through the editor.
await js(`ui.uiStore.getState().setPanelTab('Markers'); ui.uiStore.getState().setMarkersView('Models'); return true;`);
await tab.until(`!!document.querySelector('input[aria-label="Part 1 top, metres"]')`, 10_000);
const typeTop = async (v: number) => {
  await tab.eval(`(() => { const i = document.querySelector('input[aria-label="Part 1 top, metres"]'); i.focus(); i.select(); return true; })()`);
  await tab.send('Input.insertText', { text: String(v) });
  await tab.until(`window.__smoke.model().parts[0].heightM === ${v}`, 5000, 100);
  await tab.eval(`[...document.querySelectorAll('.model-editor button')].find((b) => b.textContent.trim() === 'Use as target').click()`);
  await settle(500);
  return js<{ h: number; from: string | null }>(`const w = S.world.getState(); return { h: w.pin2HeightM, from: w.pin2HeightFrom };`);
};
const typed = await typeTop(400);
await tab.shot(`${shots}/editor-typed-400.png`);
const restored = await typeTop(395);
await js(`ui.uiStore.getState().setPanelTab('Geodetics'); return true;`);
await settle(500);
const label = await tab.eval<string>(`document.body.innerText.match(/from model «[^»]*»/)?.[0] ?? ''`);
await tab.shot(`${shots}/geodetics-from-model.png`);
await js(`ui.uiStore.getState().setPanelTab('Markers'); return true;`);
check('target height = typed apex', typed.h === 400 && restored.h === 395 && typed.from === NAME && label !== '', `typed 400 → ${typed.h} m, 395 → ${restored.h} m, Geodetics says "${label}"`);

// Overture rows under the parts leave the viewfinder.
await viewfinder(HOBOKEN, TIMES.day, 24);
await drawn(24, 'Landscape');
const suppressCount = async (on: boolean) => {
  await js(`await window.__scape.models.getState().update(model().id, { suppressOverture: ${on} }); return true;`);
  await settle(3000);
  return js<number>('return S.prism.buildings;');
};
const kept = await suppressCount(false);
const dropped = await suppressCount(true);
check('Overture rows under the footprint gone', kept - dropped >= seeded.parts, `${kept} → ${dropped} buildings in view (−${kept - dropped}, ${seeded.parts} parts)`);

// Sky behind the model is occluded up to the crown and clear above it.
const occ = await js<{ below: boolean; above: boolean; crownDeg: number }>(`
  const c = await crown();
  return { below: S.prism.behindBuilding(c.az, c.alt - 0.3, Infinity), above: S.prism.behindBuilding(c.az, c.alt + 0.3, Infinity), crownDeg: c.alt };
`);
check('sky occluded up to the crown, clear above', occ.below && !occ.above, `crown ${occ.crownDeg.toFixed(2)}°: −0.3° ${occ.below ? 'hidden' : 'visible'}, +0.3° ${occ.above ? 'hidden' : 'visible'}`);

// The matrix.
const matrix: string[] = [];
let matrixOk = true;
for (const light of Object.values(Light)) {
  await viewfinder(HOBOKEN, TIMES[light], 24);
  for (const orient of ['Landscape', 'Portrait']) {
    for (const f of [24, 200, 600, 2400]) {
      for (const aim of Object.values(Aim)) {
        await js(`
          S.composition.getState().update({ focalMm: ${f}, orientation: '${orient}' });
          if (${aim === Aim.Top}) {
            const c = await crown();
            S.composition.getState().aim(c.az, c.alt);
          } else {
            const m = model(), pin = S.world.getState().pin;
            // The footprint's rightmost bearing, halfway up: the silhouette edge against the sky.
            const az = Math.max(...m.footprint.map(([lng, lat]) => geo.bearingDeg(pin, { lng, lat })));
            const d = geo.distanceM(pin, m.anchor);
            S.composition.getState().aim(az, Math.atan2(m.groundM + apex(m) * 0.6 - S.prism.cam.eyeM, d) * 180 / Math.PI);
          }
          return true;
        `);
        await drawn(f, orient);
        const p = await js<{ models: number; modelTris: number; shadowModel: number; shadowAll: number; sunAlt: number }>('const p = S.prism; return { models: p.models, modelTris: p.modelTris, shadowModel: p.shadow.casterModelTris, shadowAll: p.shadow.casterTris, sunAlt: p.cam.sunAlt };');
        const shadowOk = light === Light.Night ? p.shadowModel === 0 && p.shadowAll === 0 : p.shadowModel > 0;
        const ok = p.models >= 1 && p.modelTris > 0 && shadowOk;
        matrixOk &&= ok;
        const name = `${light}-${orient[0]}-${f}-${aim}`;
        await tab.shot(`${shots}/${name}.png`, await js('return frame();'));
        matrix.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | models ${p.models}, tris ${p.modelTris}, shadowModelTris ${p.shadowModel}, sun ${p.sunAlt.toFixed(1)}° |`);
      }
    }
  }
}
check('matrix: models ≥ 1, tris > 0, shadows by day and not at night', matrixOk, `${matrix.length} frames`);

// No z-fight: sub-pixel camera moves leave the model's pixels alone.
await viewfinder(HOBOKEN, TIMES.day, 600);
await js(`S.composition.getState().update({ focalMm: 600, orientation: 'Landscape' }); const c = await crown(); S.composition.getState().aim(c.az, c.alt); return true;`);
await drawn(600, 'Landscape');
const aim0 = await js<{ az: number; el: number }>('return { az: S.prism.cam.azimuthDeg, el: S.prism.cam.elevationDeg };');
const zBox = await js<{ x: number; y: number; width: number; height: number }>('return box();');
const zShots: string[] = [];
for (let i = 0; i < 4; i++) {
  await js(`S.composition.getState().aim(${aim0.az + i * 0.0002}, ${aim0.el}); return true;`);
  await settle(700);
  zShots.push(await tab.shot(`${shots}/zfight-${i}.png`, zBox));
}
let zWorst = 0;
for (let i = 1; i < zShots.length; i++) zWorst = Math.max(zWorst, await js<number>(`return diff(${JSON.stringify(zShots[i - 1])}, ${JSON.stringify(zShots[i])});`));
check('no z-fight in the model box', zWorst < 0.001, `worst consecutive-frame diff ${(zWorst * 100).toFixed(3)}% over ${Math.round(zBox.width)}×${Math.round(zBox.height)} px`);

// Visible from Hoboken, hidden behind the ridge: the model box at full vs half height; hiding it would bring back the Overture rows.
let shotTag = 'hoboken';
const showHide = async () => {
  const b = await js<{ x: number; y: number; width: number; height: number } | null>('return box();');
  if (!b) return { share: 0, b };
  const on = await tab.shot(`${shots}/showhide-full-${shotTag}.png`, b);
  // Parts stay in the page: JSON would turn a NaN roof direction into null.
  await js('const m = model(); window.__smokeParts = m.parts; await window.__scape.models.getState().update(m.id, { parts: m.parts.map((p) => ({ ...p, baseM: p.baseM / 2, heightM: p.heightM / 2, roofHeightM: p.roofHeightM / 2 })) }); return true;');
  await settle(3000);
  const off = await tab.shot(`${shots}/showhide-half-${shotTag}.png`, b);
  await js('await window.__scape.models.getState().update(model().id, { parts: window.__smokeParts }); return true;');
  await settle(2000);
  return { share: await js<number>(`return diff(${JSON.stringify(on)}, ${JSON.stringify(off)});`), b };
};
const seen = await showHide();
await viewfinder(RIDGE, TIMES.day, 200);
// A mast lifts the eye over Livingston's roofs so only the ridge stands in the way.
await js('S.world.getState().setPinHeight(40); return true;');
await drawn(200, 'Landscape');
await settle(4000);
await tab.shot(`${shots}/ridge.png`, await js('return frame();'));
shotTag = 'ridge';
const ridge = await showHide();
await js('S.world.getState().setPinHeight(0); return true;');
check('model hidden behind a ridge', seen.share > 0.05 && ridge.b != null && ridge.share < 0.001, `full/half-height diff ${(seen.share * 100).toFixed(1)}% from Hoboken, ${(ridge.share * 100).toFixed(3)}% behind First Watchung`);

// Ground mask: the tower's shadow, and 400 m more model darkens the lit ground beyond it.
const mask = await js<{ near: number; lit: number; flipped: number }>(`
  const m = model(), B = S.buildings;
  const sunAz = S.prism.cam.sunAz, sunAlt = S.prism.cam.sunAlt;
  const rect = { originE: -2000, originN: -2000, nx: 1000, ny: 1000, cellM: 4 };
  const down = (sunAz + 180) * Math.PI / 180;
  /** Mask cells down-sun of the anchor from a to b metres, true where shadowed. */
  const along = (f, a, b) => { const out = []; for (let s = a; s <= b; s += 4) { const ix = Math.round((s * Math.sin(down) - f.originE) / f.cellM), iy = Math.round((s * Math.cos(down) - f.originN) / f.cellM); if (ix >= 0 && iy >= 0 && ix < f.nx && iy < f.ny) out.push(f.mask[iy * f.nx + ix] > 127); } return out; };
  // The app requests masks of its own; wait for ours.
  const build = async () => { const was = B.getState().shadowMask; buildings.requestShadowMask(m.anchor, rect, sunAz, sunAlt, 5, true); for (let i = 0; i < 240; i++) { const f = B.getState().shadowMask; if (f && f !== was && f.nx === rect.nx && f.cellM === rect.cellM && f.centre.lat === m.anchor.lat) return f; await new Promise((r) => setTimeout(r, 250)); } throw new Error('no shadow mask'); };
  const a = await build();
  const nearCells = along(a, 250, 700), before = along(a, 900, 1600);
  await S.models.getState().update(m.id, { parts: m.parts.map((p) => ({ ...p, heightM: p.heightM + 400 })) });
  const after = along(await build(), 900, 1600);
  await S.models.getState().update(m.id, { parts: m.parts });
  const lit = before.filter((x) => !x).length;
  return { near: nearCells.filter(Boolean).length / Math.max(1, nearCells.length), lit, flipped: before.filter((x, i) => !x && after[i]).length / Math.max(1, lit) };
`, 150_000);
check('ground mask shows the model shadow', mask.near > 0.3 && mask.lit > 10 && mask.flipped > 0.8, `shadowed ${(mask.near * 100).toFixed(0)}% of 250–700 m down-sun; +400 m shades ${(mask.flipped * 100).toFixed(0)}% of the ${mask.lit} lit cells 0.9–1.6 km out`);

// Map view of the shadow.
await tab.navigate(`${BASE}/`);
await tab.until('!!window.__scape?.models?.getState().loaded', 60_000);
await js(`S.world.getState().setTime(Date.parse(${JSON.stringify(TIMES.day)})); S.world.getState().setView({ center: { lng: -73.998, lat: 40.7555 }, zoom: 15.2 }); return true;`);
await settle(8000);
await tab.shot(`${shots}/map-shadow.png`);

// Reload keeps the model.
const before = await js<string>('const m = model(); return m.id + "|" + m.updatedAt + "|" + m.parts.length;');
await tab.reload();
const after = await tab.until<string>(`(() => { const m = window.__scape?.models?.getState().models.find((m) => m.name === ${JSON.stringify(NAME)}); return m && m.id + "|" + m.updatedAt + "|" + m.parts.length; })()`, 30_000);
check('persists across reload', after === before, `${before} → ${after}`);

// Offline: the built app from its service worker, the model from IndexedDB.
if (preview !== '-') {
  const record = await js<string>(`return JSON.stringify(model(), (k, v) => (typeof v === 'number' && Number.isNaN(v) ? '__NaN__' : v));`);
  const PREV = `http://localhost:${preview}`;
  await tab.navigate(`${PREV}/`);
  await tab.eval('navigator.serviceWorker.ready.then(() => true)', 60_000);
  await tab.reload();
  await tab.until('navigator.serviceWorker.controller != null', 30_000);
  await tab.until(`indexedDB.databases().then((d) => d.some((x) => x.name === 'scape' && x.version >= 4))`, 30_000);
  await tab.eval(`new Promise((res, rej) => { const q = indexedDB.open('scape'); q.onsuccess = () => { const tx = q.result.transaction('models', 'readwrite'); tx.objectStore('models').put(JSON.parse(${JSON.stringify(record)}, (k, v) => (v === '__NaN__' ? NaN : v))); tx.oncomplete = () => { q.result.close(); res(true); }; tx.onerror = () => rej(tx.error); }; q.onerror = () => rej(q.error); })`);
  await tab.setOffline(true);
  await tab.reload();
  await settle(4000);
  const listed = await tab.until<boolean>(`(() => { const click = (t) => [...document.querySelectorAll('button, [role=tab]')].find((b) => b.textContent.trim() === t)?.click(); click('Markers'); click('Models'); return document.body.innerText.includes(${JSON.stringify(NAME)}); })()`, 20_000);
  await tab.shot(`${shots}/offline-panel.png`);
  await tab.navigate(`${PREV}/viewfinder?camera=${HOBOKEN}&target=${TOWER.lat},${TOWER.lng}&f=200&t=${TIMES.day}`);
  await settle(8000);
  const title = await tab.eval<string>('document.title');
  await tab.shot(`${shots}/offline-viewfinder.png`);
  await tab.setOffline(false);
  check('persists offline', listed === true && title === 'Scape', `SW-served page "${title}", model ${listed ? 'listed' : 'missing'}`);
}

await tab.navigate(`${BASE}/`);
tab.close();
console.log('| Check | Result | Numbers |\n| --- | --- | --- |');
console.log(rows.join('\n'));
console.log('\n| Frame | Result | Numbers |\n| --- | --- | --- |');
console.log(matrix.join('\n'));
process.exit(failed ? 1 : 0);
