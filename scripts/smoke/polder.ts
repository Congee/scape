// Ground below sea level: a polder's eye and mesh sit on its true ground, and settled pictures elsewhere match a baseline.
// Usage: bun scripts/smoke/polder.ts <cdp> <dev-port> <shot-dir> [baseline-dir|-]
/* oxlint-disable no-await-in-loop -- CDP steps are sequential */
import { existsSync, mkdirSync } from 'node:fs';
import { decodePng } from '../../src/lib/core/terrain/png';
import { Tab } from './cdp';

const [cdp = '9433', port = '5433', shots = '/tmp/polder', baseline = '-'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });

const SCENES = {
  // Zermatt facing the Matterhorn.
  alps: { camera: '46.0207,7.7491', target: '45.9766,7.6586', day: '2026-10-18T09:00Z', night: '2026-10-25T21:00Z' },
  // Rotterdam, Erasmusbrug towards the Maastoren.
  flat: { camera: '51.9050,4.4830', target: '51.9153,4.4890', day: '2026-10-18T11:00Z', night: '2026-10-25T21:00Z' },
  // Midtown towards the Empire State Building.
  manhattan: { camera: '40.7580,-73.9855', target: '40.7484,-73.9857', day: '2026-10-18T15:00Z', night: '2026-10-26T01:00Z' },
  // Pier 84 across the Hudson, where the DEM's river sits 1.5 m below sea level.
  hudson: { camera: '40.7637,-74.0010', target: '40.7650,-74.0250', day: '2026-10-18T15:00Z', night: '2026-10-26T01:00Z' },
  // Zuidplaspolder, about 6 m below sea level, looking east over the polder.
  polder: { camera: '52.0050,4.6200', target: '52.0050,4.6600', day: '2026-10-18T11:00Z', night: '2026-10-25T21:00Z' }
} as const;
type Scene = keyof typeof SCENES;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);

const SETTLED = `(() => {
  const S = window.__scape, t = S.terrain.getState(), p = S.prism;
  return !t.busy.Mesh && !t.busy.View && !t.busy.Elevation && t.mesh.length > 0 && t.mesh.length === t.mesh[0].levels && !!p?.terrain && p.terrain.levels === t.mesh.length && !S.buildings.getState().busy && !p.lod2?.busy;
})()`;
const go = async (url: string) => {
  await tab.eval("try { localStorage.removeItem('scape.composition') } catch {}");
  await tab.navigate(url);
  await tab.until('!!(window.__scape && document.querySelector("canvas.vf"))', 30_000, 250);
  if ((await tab.eval<string>('document.visibilityState')) !== 'visible') throw new Error('smoke tab is hidden: another tab is active in its window');
  const ok = await tab.until(SETTLED, 90_000, 250);
  await Bun.sleep(1500);
  return !!ok && (await tab.eval<boolean>(SETTLED));
};
const url = (s: Scene, f: number, o: 'l' | 'p', time: 'day' | 'night') => `${BASE}/viewfinder?camera=${SCENES[s].camera}&target=${SCENES[s].target}&t=${SCENES[s][time]}&f=${f}${o === 'p' ? '&o=p' : ''}`;
const FRAME = `(() => { const r = document.querySelector('canvas.vf').getBoundingClientRect(), f = window.__scape.prism.cam.frame; return { x: r.left + f.x, y: r.top + f.y, w: f.w, h: f.h }; })()`;

/** Pixels that differ inside the picture frame. */
const diff = async (a: string, b: string) => {
  const r = await tab.eval<{ x: number; y: number; w: number; h: number }>(FRAME);
  const [x, y] = await Promise.all([a, b].map(async (f) => decodePng(new Uint8Array(await Bun.file(f).arrayBuffer()))));
  if (x.width !== y.width || x.height !== y.height || x.channels !== y.channels) return { size: true, px: -1, max: 255 };
  const n = x.channels, s = x.width / (await tab.eval<number>('innerWidth'));
  const x0 = Math.floor(r.x * s), x1 = Math.ceil((r.x + r.w) * s), y0 = Math.floor(r.y * s), y1 = Math.ceil((r.y + r.h) * s);
  let px = 0, max = 0;
  for (let py = y0; py < y1; py++)
    for (let qx = x0; qx < x1; qx++) {
      const k = (py * x.width + qx) * n;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(x.data[k + c] - y.data[k + c]));
      if (d === 0) continue;
      px++;
      if (d > max) max = d;
    }
  return { size: false, px, max };
};

await tab.viewport(1400, 900);
for (const s of ['alps', 'flat', 'manhattan', 'hudson'] as const)
  for (const [f, o, time] of [[24, 'l', 'day'], [600, 'l', 'day'], [24, 'p', 'night']] as const) {
    const name = `${s}-${f}-${o}-${time}.png`;
    const ok = await go(url(s, f, o, time));
    await tab.shot(`${shots}/${name}`);
    check(`${name} settles`, ok, ok ? 'mesh complete' : 'still busy');
    const ref = `${baseline}/${name}`;
    if (baseline === '-' || !existsSync(ref)) continue;
    const d = await diff(ref, `${shots}/${name}`);
    check(`${name} vs baseline`, !d.size && d.px === 0, d.size ? 'size differs' : `${d.px} px differ, max Δ ${d.max}`);
  }

// The polder: each eye stands its height above its own negative ground.
type Eye = { g: number | null; e: number | null };
const EYES = `(() => { const t = window.__scape.terrain.getState(), m = t.mesh[0], v = t.view, p = t.profile; return { above: window.__scape.world.getState().pinHeightM + 1.6, pin: t.pinGroundM, view: v ? { g: v.groundM, e: v.eyeM } : null, mesh: m ? { g: m.groundM, e: m.eyeM } : null, sightline: p ? { g: p.groundA, e: p.eyeM } : null }; })()`;
type Eyes = { above: number; pin: number | null; view: Eye | null; mesh: Eye | null; sightline: Eye | null };
const eyeChecks = (tag: string, r: Eyes, which: readonly ('view' | 'mesh' | 'sightline')[]) => {
  check(`${tag} ground below sea level`, r.pin != null && r.pin < -4, `pin ground ${r.pin?.toFixed(2)} m`);
  for (const k of which) {
    const x = r[k];
    const ok = x?.g != null && x.e != null && x.g < -4 && Math.abs(x.e - x.g - r.above) < 0.01;
    check(`${tag} ${k} eye on the ground`, ok, x ? `ground ${x.g?.toFixed(2)} m, eye ${x.e?.toFixed(2)} m (+${r.above.toFixed(1)})` : 'missing');
  }
};
for (const [w, h, tag] of [[1400, 900, 'desktop'], [390, 844, 'phone']] as const) {
  await tab.viewport(w, h);
  for (const [f, o, time] of [[24, 'l', 'day'], [200, 'p', 'night']] as const) {
    const name = `polder-${tag}-${f}-${o}-${time}.png`;
    const ok = await go(url('polder', f, o, time));
    await tab.shot(`${shots}/${name}`);
    check(`${name} settles`, ok, ok ? 'mesh complete' : 'still busy');
    eyeChecks(name, await tab.eval<Eyes>(EYES), ['view', 'mesh']);
  }
}
await tab.viewport(1400, 900);
await tab.navigate(`${BASE}/?camera=${SCENES.polder.camera}&target=${SCENES.polder.target}&t=${SCENES.polder.day}`);
await tab.until('!!(window.__scape && window.__scape.terrain.getState().profile && window.__scape.terrain.getState().pinGroundM != null)', 60_000, 250);
eyeChecks('map', await tab.eval<Eyes>(EYES), ['sightline']);

console.log('\n| check | result | detail |\n|---|---|---|');
console.log(rows.join('\n'));
tab.close();
process.exit(failed ? 1 : 0);
