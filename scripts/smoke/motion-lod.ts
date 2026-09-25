// Motion LOD: a wide canvas hides the listed basemap layers and loads coarse tiles while zooming, and restores both after; a narrow one is untouched.
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
// Usage: bun scripts/smoke/motion-lod.ts <cdp> <dev-port> <WxH> <shot.png>
import { MOTION_HIDDEN_LAYERS } from '../../src/lib/ui/map/motionLod';
import { Tab } from './cdp';
import { Scenes, sceneUrl } from './map-zoom-scenes';

const [cdp = '9427', port = '5427', vp = '2600x1400', shot = '/tmp/motion-lod.png'] = process.argv.slice(2);
const [vw, vh] = vp.split('x').map(Number);
const origin = `http://localhost:${port}`;
const tab = await Tab.open(Number(cdp), origin);
await tab.viewport(vw, vh, 1);
await tab.logRequests();
// Below the basemap's maxzoom and within one zoom level, so the fine tiles after the pinch are the ones before it.
await tab.navigate(sceneUrl(origin, { ...Scenes.rotterdam, z: 12.1 }));
if (!(await tab.until('window.__scapeMap?.isStyleLoaded()', 60_000))) throw new Error('map never loaded');

const IDLE = `new Promise((r) => { const m = __scapeMap; const t = setTimeout(() => r(false), 30000); m.once('idle', () => { clearTimeout(t); r(true); }); m.triggerRepaint(); })`;
await tab.eval(IDLE, 40_000);
await Bun.sleep(1000);
await tab.eval(IDLE, 40_000);

// Listed non-symbol layers shown now, the basemap's vector tile sizes, and a per-frame sampler of both.
const state = `(() => {
  const m = __scapeMap, ids = ${JSON.stringify(MOTION_HIDDEN_LAYERS)};
  const shown = ids.filter((id) => { const l = m.getLayer(id); return l && l.type !== 'symbol' && (m.getLayoutProperty(id, 'visibility') ?? 'visible') === 'visible'; });
  const sizes = Object.fromEntries(Object.entries(m.getStyle().sources).filter(([, s]) => s.type === 'vector').map(([id]) => [id, m.getSource(id).tileSize]));
  return { width: m.getCanvas().clientWidth, shown, sizes };
})()`;
type State = { width: number; shown: string[]; sizes: Record<string, number> };
const before = await tab.eval<State>(state);
await tab.eval(`(() => {
  const m = __scapeMap, ids = ${JSON.stringify(before.shown)};
  const s = (window.__mlod = { maxHidden: 0, coarse: 0, frames: 0 });
  m.on('render', () => {
    s.frames++;
    s.maxHidden = Math.max(s.maxHidden, ids.filter((id) => m.getLayoutProperty(id, 'visibility') === 'none').length);
    for (const id of Object.keys(${JSON.stringify(before.sizes)})) if (m.getSource(id)?.tileSize > 512) s.coarse++;
  });
  return 1;
})()`);
const TILE = /\.(pbf|mvt)(\?|$)/;
const tilesBefore = new Set(tab.requests.filter((u) => TILE.test(u)));
tab.requests.length = 0;

// A trackpad pinch in: fractional deltas each frame, then a pause, then a second burst.
const c = await tab.eval<{ x: number; y: number }>('(() => { const r = __scapeMap.getCanvas().getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()');
for (const burst of [20, 15]) {
  for (let i = 0; i < burst; i++) {
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -2.5, modifiers: 2 });
    await Bun.sleep(16);
  }
  await Bun.sleep(60);
}
const during = await tab.eval<{ maxHidden: number; coarse: number; frames: number }>('({ ...window.__mlod })');
await Bun.sleep(400);
await tab.eval(IDLE, 40_000);
const after = await tab.eval<State>(state);
await tab.shot(shot);
const fetched = tab.requests.filter((u) => TILE.test(u));
const refetched = fetched.filter((u, i) => tilesBefore.has(u) || fetched.indexOf(u) !== i).length;
const zoom = await tab.eval<number>('__scapeMap.getZoom()');
tab.close();
console.log(JSON.stringify({ viewport: vp, width: before.width, listed: before.shown.length, sizes: before.sizes, ...during, restored: after.shown.length, sizesAfter: after.sizes, missing: before.shown.filter((id) => !after.shown.includes(id)), fetched: fetched.length, refetched, zoom }));
