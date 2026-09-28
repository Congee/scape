// Viewfinder shadow smoke: the shadow map covers the whole filled view, in-frame texels stay as fine, and the extra memory goes when idle.
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
// Usage: bun scripts/smoke/vfshadow.ts <cdp> <port> [shot-dir] [shots-only]
import { mkdirSync } from 'node:fs';
import { Tab } from './cdp';

const [cdp = '9810', port = '5810', shots = `${process.env.TMPDIR ?? '/tmp'}/vfshadow`, shotsOnly = ''] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });
// De Rotterdam from the Maas: towers throw long shadows over the water and the quays.
const CAMERA = '51.9091,4.4868';
const TARGET = '51.90664,4.48805';
const TIMES = { day: '2026-06-21T12:00Z', evening: '2026-06-21T18:40Z' } as const;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const SETTLED = `(() => {
  const S = window.__scape, t = S.terrain.getState(), p = S.prism;
  return !t.busy.Mesh && !t.busy.View && t.mesh.length > 0 && t.mesh.length === t.mesh[0].levels && !!p?.terrain && p.terrain.levels === t.mesh.length && !S.buildings.getState().busy && !p.lod2?.busy;
})()`;

const tab = await Tab.open(Number(cdp), BASE);
await tab.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'service_workers,cache_storage' });
await tab.fresh(BASE);

const go = async (url: string) => {
  await tab.eval("try { localStorage.removeItem('scape.composition') } catch {}");
  await tab.navigate(url);
  await tab.until('!!(window.__scape && document.querySelector("canvas.vf"))', 30_000, 250);
  await tab.eval('window.__scape.ui.setState({ panelCollapsed: true })');
};
const settle = async () => {
  const ok = await tab.until(`!!window.__scape.prism && ${SETTLED}`, 90_000, 250);
  await Bun.sleep(1500);
  return !!ok && (await tab.eval<boolean>(SETTLED));
};

type Info = { farM: number; texelXM: number; texelYM: number };
type Shade = { on: boolean; cascades: number; info: Info[]; fit?: { res: number; baseRes: number; maxRes: number; capped: boolean; frameTexel: [number, number][]; outer: Info[]; coverTan: number; fillTan: number } };

async function scene(tag: string, w: number, h: number, dpr: number, f: number, portrait: boolean, time: keyof typeof TIMES) {
  await tab.viewport(w, h, dpr);
  await go(`${BASE}/viewfinder?camera=${CAMERA}&target=${TARGET}&t=${TIMES[time]}&f=${f}${portrait ? '&o=p' : ''}`);
  const ok = await settle();
  await tab.shot(`${shots}/${tag}.png`);
  const s = await tab.eval<Shade>('window.__scape.prism.shadow');
  check(`${tag} settles with shadows on`, ok && s.on && s.cascades > 0, `${s.cascades} cascades`);
  if (shotsOnly) return;
  const fit = s.fit;
  check(`${tag} shadow map covers the whole view`, !!fit && fit.coverTan >= fit.fillTan * (1 - 1e-6), fit ? `cover tan ${fit.coverTan.toFixed(4)}, view tan ${fit.fillTan.toFixed(4)}${fit.capped ? `, outer set ${fit.outer.length}` : ''}` : 'no fit stats');
  if (!fit) return;
  // Texels over the frame no coarser than a frame-only fit at the base resolution.
  const worst = Math.max(...s.info.map((c, i) => Math.max(c.texelXM / fit.frameTexel[i][0], c.texelYM / fit.frameTexel[i][1])));
  check(`${tag} in-frame shadow detail kept`, worst <= 1.0001, `res ${fit.res} (base ${fit.baseRes}, cap ${fit.maxRes})${fit.capped ? ' capped' : ''}, worst texel ratio ${worst.toFixed(4)}`);
  const held = await tab.until<boolean>('window.__scape.shadowBytes() <= window.__scape.shadowBaseBytes', 20_000, 500);
  const bytes = await tab.eval<[number, number]>('[window.__scape.shadowBytes(), window.__scape.shadowBaseBytes]');
  check(`${tag} extra shadow memory released when idle`, !!held, `${(bytes[0] / 2 ** 20).toFixed(0)} MB held, base ${(bytes[1] / 2 ** 20).toFixed(0)} MB`);
}

await scene('desktop-24mm-portrait-evening', 1440, 900, 2, 24, true, 'evening');
await scene('desktop-200mm-portrait-evening', 1440, 900, 2, 200, true, 'evening');
await scene('desktop-600mm-portrait-day', 1440, 900, 2, 600, true, 'day');
await scene('phone-24mm-landscape-day', 390, 844, 3, 24, false, 'day');

await tab.send('Emulation.clearDeviceMetricsOverride');
tab.close();
console.log('| check | result | detail |\n|---|---|---|');
console.log(rows.join('\n'));
process.exit(failed ? 1 : 0);
