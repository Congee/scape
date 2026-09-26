// Map shadow mask through a sinking sun: few re-stamps, each one matching its request, shadows drawn, no errors.
/* oxlint-disable no-await-in-loop -- clock steps run one after another */
// Usage: bun scripts/smoke/maskstrips.ts <cdp> <port> [shot-dir]
import { mkdirSync } from 'node:fs';
import { Tab } from './cdp';

const [cdp = '9770', port = '5770', shots = `${process.env.TMPDIR ?? '/tmp'}/maskstrips`] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });
// De Rotterdam at dawn: the grid grows up-sun, then coarsens.
const URL_MAP = `${BASE}/?camera=51.9091,4.4868&target=51.90664,4.48805&z=16.5`;
const FROM = Date.parse('2026-09-26T02:30:00Z');
const MINUTES = 130;
const MAX_RESTAMPS = 6;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const SPY = `(() => {
  if (window.__masks) return 1;
  window.__masks = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (m, ...r) {
    if (m && m.kind === 'Mask') window.__masks.push([m.originE, m.originN, m.nx, m.ny, m.cellM].join(','));
    return post.call(this, m, ...r);
  };
  return 1;
})()`;
const BUILT = `(() => {
  const s = window.__scape.buildings.getState(), m = s.shadowMask;
  if (!m) return { key: '', ms: 0, shaded: 0, cells: 0, error: s.error };
  let shaded = 0;
  for (const v of m.mask) if (v > 0) shaded++;
  return { key: [m.originE, m.originN, m.nx, m.ny, m.cellM].join(','), ms: s.shadowMaskMs, shaded, cells: m.nx * m.ny, error: s.error };
})()`;
type Built = { key: string; ms: number; shaded: number; cells: number; error: string | null };

async function walk(tab: Tab, tag: string, width: number, height: number) {
  await tab.viewport(width, height);
  await tab.navigate(URL_MAP);
  await tab.until('window.__scape?.idle', 30_000);
  await tab.eval(`window.__scape.world.getState().setTime(${FROM}); 1`);
  await tab.eval(SPY);
  await tab.until(`window.__scape.buildings.getState().shadowMask !== null`, 60_000);
  let last = '';
  let restamps = 0;
  let ms = 0;
  let bad = '';
  for (let i = 1; i < MINUTES; i++) {
    await tab.eval(`window.__scape.world.getState().setTime(${FROM + i * 60_000}); 1`);
    await Bun.sleep(400);
    const want = (await tab.eval<string[]>('window.__masks')).at(-1) ?? last;
    if (want === last) continue;
    const settled = (await tab.until(`(${BUILT}).key === ${JSON.stringify(want)}`, 60_000, 200)) !== null;
    const b = await tab.eval<Built>(BUILT);
    if (last) restamps++;
    ms += b.ms;
    if (!settled || b.error || b.cells === 0) bad ||= `${new Date(FROM + i * 60_000).toISOString().slice(11, 16)} ${settled ? (b.error ?? 'empty') : 'never built'}`;
    last = want;
  }
  const b = await tab.eval<Built>(BUILT);
  check(`${tag}: every re-stamp builds its request`, !bad, bad || `${restamps} re-stamps, ${Math.round(ms)} ms worker wall`);
  check(`${tag}: few re-stamps`, restamps <= MAX_RESTAMPS, `${restamps} ≤ ${MAX_RESTAMPS}`);
  check(`${tag}: shadows in the mask`, b.shaded > 0 && b.shaded < b.cells, `${b.shaded} of ${b.cells} cells shaded`);
  await tab.shot(`${shots}/${tag}.png`);
}

const tab = await Tab.open(Number(cdp), BASE);
await tab.eval(`localStorage.setItem('scape.ui', JSON.stringify({ state: { panelTab: 'Timeline', panelCollapsed: false, markersView: 'Markers' }, version: 0 }))`).catch(() => {});
await walk(tab, 'desktop', 1400, 900);
await walk(tab, 'phone', 390, 844);
tab.close();

console.log('| check | result | detail |\n|---|---|---|');
console.log(rows.join('\n'));
process.exit(failed ? 1 : 0);
