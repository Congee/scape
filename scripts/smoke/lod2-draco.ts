// LoD2 Draco smoke: swissBUILDINGS3D and PLATEAU tiles decode and replace Overture; only they fetch the decoder, Rotterdam never does.
/* oxlint-disable no-await-in-loop -- smoke steps run one scene at a time */
// Usage: bun scripts/smoke/lod2-draco.ts <cdp> <dev-port> <shot-dir>
import { Tab } from './cdp';

const [cdp = '9402', port = '5402', shots = '/tmp/lod2'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
// Europe's day and night; at night the sun and the first-quarter moon are both down.
const DAY = '2026-06-21T13:00Z';
const NIGHT = '2026-06-21T23:45Z';
const Scene = {
  // On the Erasmusbrug, facing De Rotterdam: 3DBAG, meshopt only.
  NL: { camera: '51.9091,4.4868', target: '51.90664,4.48805', credit: '3DBAG', day: DAY, night: NIGHT },
  // Lindenhof toward the Grossmünster: swissBUILDINGS3D.
  CH: { camera: '47.3769,8.5417', target: '47.3700,8.5441', credit: 'swisstopo', day: DAY, night: NIGHT },
  // Marunouchi toward Tokyo Station: PLATEAU Chiyoda.
  JP: { camera: '35.6812,139.7640', target: '35.6812,139.7671', credit: 'PLATEAU', day: '2026-06-21T03:00Z', night: '2026-06-21T17:00Z' }
} as const;
type Scene = (typeof Scene)[keyof typeof Scene];

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const SETTINGS = `(() => { window.__scape.settings.getState().update({ terrain: true, showSunShadows: true, lightSource: 'Auto' }); window.__scape.composition.getState().update({ showBuildings: true }); return true; })()`;
const READY = `(() => { const S = window.__scape, p = S?.prism; return !!(p && p.lod2 && !p.lod2.busy && p.lod2.tiles > 0 && p.modelTris > 0 && !S.buildings.getState().busy); })()`;
const STATS = `(() => { const p = window.__scape.prism, l = p.lod2; return { tiles: l.tiles, tris: l.tris, hidden: l.hiddenRows, missing: l.missing, error: l.error, prisms: p.buildings, drawn: p.modelTris, shadow: p.shadow.on, light: p.shadow.light, casters: p.shadow.casterModelTris, credit: [...document.querySelectorAll('[data-lod2]')].map((e) => e.textContent.trim()).join(' | ') }; })()`;
type Stats = { tiles: number; tris: number; hidden: number; missing: number; error: string | null; prisms: number; drawn: number; shadow: boolean; light: string; casters: number; credit: string };

// Background only; the hidden-tab rAF shim keeps frames coming.
const tab = await Tab.open(Number(cdp), BASE, { front: false });
await tab.viewport(1400, 900);

async function view(s: Scene, t: string, shot: string): Promise<Stats> {
  const url = `${BASE}/viewfinder?camera=${s.camera}&target=${s.target}&t=${t}&f=24`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 0) await tab.navigate(url);
    else await tab.reload();
    await tab.until(`!!window.__scape && ${SETTINGS}`, 30_000);
    if (await tab.until(READY, 120_000)) break;
  }
  await tab.shot(`${shots}/${shot}.png`);
  return tab.eval<Stats>(STATS);
}

const dracoUrls = () => tab.requests.filter((u) => /draco/i.test(u));

await tab.logRequests();
const nl = await view(Scene.NL, DAY, 'draco-nl-day');
check('NL: no Draco request from the page or its workers', nl.tiles > 0 && dracoUrls().length === 0 && tab.requests.some((u) => u.includes('3dbag')), `${dracoUrls().length} Draco URLs among ${tab.requests.length} requests; ${nl.tiles} LoD2 tiles`);

for (const [tag, s] of [['CH', Scene.CH], ['JP', Scene.JP]] as const) {
  await tab.logRequests();
  const d = await view(s, s.day, `draco-${tag.toLowerCase()}-day`);
  check(`${tag} day: LoD2 drawn, Overture rows hidden`, d.tiles > 0 && d.tris > 0 && d.drawn > 0 && d.missing === 0 && d.hidden > 0, `${d.tiles} tiles, ${d.tris} tris kept, ${d.drawn} drawn, ${d.hidden} hidden, ${d.prisms} prisms, ${d.missing} missing, error ${d.error ?? '-'}`);
  check(`${tag} day: shadows on, LoD2 casts`, d.shadow && d.light === 'Sun' && d.casters > 0, `on ${d.shadow}, light ${d.light}, ${d.casters} caster tris`);
  check(`${tag}: ${s.credit} credit, Draco decoder fetched`, d.credit.includes(s.credit) && dracoUrls().some((u) => u.endsWith('.wasm')), `${d.credit}; ${dracoUrls().length} Draco URLs`);
  const n = await view(s, s.night, `draco-${tag.toLowerCase()}-night`);
  check(`${tag} night: LoD2 drawn, no shadows`, n.tiles > 0 && n.hidden > 0 && !n.shadow, `${n.tiles} tiles, ${n.hidden} hidden; shadows ${n.shadow}, light ${n.light}`);
}

// The map's shadow mask stamps swissBUILDINGS3D and credits it.
await tab.navigate(`${BASE}/?camera=${Scene.CH.camera}&target=${Scene.CH.target}&t=${DAY}&z=16.5`);
await tab.until('window.__scapeMap && window.__scape.buildings.getState().shadowMask && window.__scapeMap.getLayoutProperty("sun-shadow", "visibility") === "visible" && !window.__scape.buildings.getState().busy', 120_000);
await Bun.sleep(1000);
await tab.shot(`${shots}/draco-map-ch.png`);
const map = await tab.eval<{ n: number; credit: boolean }>(`(() => ({ n: window.__scape.buildings.getState().shadowMask?.lod2.length ?? -1, credit: (document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? '').includes('swisstopo') }))()`);
check('map CH: mask uses LoD2, swisstopo credited', map.n > 0 && map.credit, `${map.n} LoD2 sources in the mask, credit ${map.credit}`);

// Leave nothing rendering.
await tab.navigate('about:blank');
tab.close();
console.log(rows.join('\n'));
process.exit(failed > 0 ? 1 : 0);
