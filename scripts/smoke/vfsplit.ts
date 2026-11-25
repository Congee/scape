// Viewfinder pixel identity: fixed scenes (night sky, day with buildings and the sun path, markers and a target), desktop and phone.
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
// Usage: bun scripts/smoke/vfsplit.ts <cdp> <port> <shot-dir> [reference-shot-dir]
// With a reference dir of the same scenes shot on another build, every pixel must match it.
import { existsSync, mkdirSync } from 'node:fs';
import { decodePng } from '../../src/lib/core/terrain/png';
import { Tab } from './cdp';

const [cdp = '9484', port = '5484', shots = `${process.env.TMPDIR ?? '/tmp'}/vfsplit`, ref = ''] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });
// De Rotterdam from the Maas: terrain plus 3DBAG buildings in the frame.
const CAMERA = '51.9091,4.4868';
const TARGET = '51.90664,4.48805';
const VIEWPORTS = { desktop: { w: 1440, h: 900, dpr: 2 }, phone: { w: 390, h: 844, dpr: 3 } } as const;
const SKY_ON = 'showStars: true, showStarNames: true, showConstellations: true, showTrails: true, trailMinutes: 60, showRadiants: true, showMilkyWay: true, showMoon: true, showPaths: true';
const marker = (id: string, name: string, lat: number, lng: number, shape: string, heightM: number, widthM: number) =>
  `{ id: '${id}', name: '${name}', category: 'Building', lat: ${lat}, lng: ${lng}, heightM: ${heightM}, widthM: ${widthM}, shape: '${shape}', depthM: ${widthM}, rotationDeg: 20, rating: 0, notes: '', showInViewfinder: true, createdAt: 0, updatedAt: 0 }`;
const MARKERS = [marker('vfs-bar', 'Bar', 51.9055, 4.4890, 'Bar', 60, 20), marker('vfs-box', 'Box', 51.9040, 4.4850, 'Box', 80, 40), marker('vfs-cyl', 'Cylinder', 51.9030, 4.4920, 'Cylinder', 50, 30), marker('vfs-spire', 'Spire', 51.9010, 4.4870, 'Spire', 120, 25)].join(', ');
interface Scene {
  tag: string;
  url: string;
  patch: string;
  markers?: boolean;
}
const SCENES: Scene[] = [
  // Full moon high in a January night, aimed at it: stars, names, figures, trails, radiants, pole marks.
  { tag: 'night-moon', url: `camera=${CAMERA}&target=${TARGET}&t=2026-01-03T22:00Z&f=24&a=m`, patch: SKY_ON },
  { tag: 'night-pole', url: `camera=${CAMERA}&target=${TARGET}&t=2026-01-03T22:00Z&f=35&a=f&az=0&el=45`, patch: SKY_ON },
  // Summer morning over the towers, the sun's path crossing the frame.
  { tag: 'day-sunpath', url: `camera=${CAMERA}&target=${TARGET}&t=2026-06-21T07:00Z&f=24&a=f&az=110&el=15`, patch: 'showPaths: true, showSun: true, showBuildings: true, showMarkers: false' },
  { tag: 'day-markers', url: `camera=${CAMERA}&target=${TARGET}&t=2026-06-21T13:00Z&f=24`, patch: 'showMarkers: true, showGrid: true, showPaths: true', markers: true }
];

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
await tab.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'service_workers,cache_storage' });
await tab.fresh(BASE);

const js = <T = unknown>(body: string, timeoutMs = 60_000) => tab.eval<T>(`(async () => { const S = window.__scape; ${body} })()`, timeoutMs);
const SETTLED = `(() => {
  const S = window.__scape, t = S.terrain.getState(), p = S.prism;
  return !!p && !t.busy.Mesh && !t.busy.View && t.mesh.length > 0 && t.mesh.length === t.mesh[0].levels && !!p.terrain && p.terrain.levels === t.mesh.length && !S.buildings.getState().busy && !p.lod2?.busy && !S.sky.getState().loading;
})()`;

type Img = Awaited<ReturnType<typeof decodePng>>;
const load = async (p: string) => decodePng(new Uint8Array(await Bun.file(p).arrayBuffer()));
type Box = { x0: number; y0: number; x1: number; y1: number };
/** Differing pixels inside a device-px box and their bounding box. */
const compare = (a: Img, b: Img, r: Box) => {
  if (a.width !== b.width || a.height !== b.height) return null;
  let n = 0, max = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let j = r.y0; j < r.y1; j++)
    for (let i = r.x0; i < r.x1; i++) {
      const k = (j * a.width + i) * a.channels;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[k + c] - b.data[k + c]));
      if (d === 0) continue;
      n++;
      max = Math.max(max, d);
      x0 = Math.min(x0, i);
      y0 = Math.min(y0, j);
      x1 = Math.max(x1, i);
      y1 = Math.max(y1, j);
    }
  return { n, max, box: n ? `${x0},${y0}–${x1},${y1}` : '' };
};

for (const sc of SCENES)
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const tag = `${sc.tag}-${vpName}`;
    await tab.viewport(vp.w, vp.h, vp.dpr);
    await tab.eval("try { localStorage.removeItem('scape.composition') } catch {}");
    await tab.navigate(`${BASE}/viewfinder?${sc.url}`);
    await tab.until('!!(window.__scape && document.querySelector("canvas.vf"))', 30_000, 250);
    await js(`S.ui.setState({ panelCollapsed: true }); S.composition.getState().update({ ${sc.patch} }); ${sc.markers ? `S.markers.setState({ markers: [${MARKERS}] });` : ''} return true;`);
    const ok = !!(await tab.until(SETTLED, 90_000, 250));
    await Bun.sleep(2000);
    // Waits for an overlay frame drawn after everything settled.
    await js('const t = Date.now(); for (let i = 0; i < 50 && !(S.overlay?.at > t); i++) await new Promise((r) => setTimeout(r, 100)); return true;');
    const seen = await js<{ marks: number; bodies: string[]; markers: number; labels: number }>('return { marks: S.marks?.count ?? 0, bodies: Object.keys(S.overlay?.bodies ?? {}), markers: Object.keys(S.overlay?.markers ?? {}).length, labels: S.overlay?.pathLabels?.length ?? 0 };');
    // The viewfinder canvas only: the time chart and toolbar outside it have their own noise.
    const canvas = await tab.eval<Box>(`(() => { const r = document.querySelector('canvas.vf').getBoundingClientRect(), s = devicePixelRatio; return { x0: Math.max(0, Math.round(r.left * s)), y0: Math.max(0, Math.round(r.top * s)), x1: Math.round(r.right * s), y1: Math.round(r.bottom * s) }; })()`);
    const path = `${shots}/${tag}.png`;
    await tab.shot(path);
    await tab.shot(path);
    check(`${tag} settles`, ok, `${seen.marks} sky marks, bodies ${seen.bodies.join('/') || 'none'}, ${seen.markers} markers, ${seen.labels} path labels`);
    const refPath = `${ref}/${tag}.png`;
    if (ref && existsSync(refPath)) {
      const d = compare(await load(refPath), await load(path), canvas);
      check(`${tag} canvas pixels match the reference`, !!d && d.n === 0, d ? (d.n ? `${d.n} px differ, max Δ ${d.max}, box ${d.box}` : 'identical') : 'size differs');
    }
  }

await tab.send('Emulation.clearDeviceMetricsOverride');
tab.close();
console.log('| check | result | detail |\n|---|---|---|');
console.log(rows.join('\n'));
process.exit(failed ? 1 : 0);
