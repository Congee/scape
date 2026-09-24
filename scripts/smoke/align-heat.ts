// Find panel heat layer smoke: every align-worker mode from its button, and a map-click pick in Align mode.
/* oxlint-disable no-await-in-loop -- smoke steps run one at a time */
// Usage: bun scripts/smoke/align-heat.ts <cdp> <dev-port> <preview-port|-> <shot-dir>
import { Tab } from './cdp';

const [cdp = '9374', port = '5370', , shots = '/tmp/align-heat'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
// Zermatt looking at the Matterhorn, a morning sun.
const PIN = { lat: 46.0207, lng: 7.7491 };
const TARGET = { lat: 45.9763, lng: 7.6586 };
const TIME = '2026-09-24T09:00Z';
const MODES = ['Viewshed', 'Visible', 'Align', 'Time'] as const;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
await tab.activate();
await tab.viewport(1280, 800);
await tab.navigate(`${BASE}/?camera=${PIN.lat},${PIN.lng}&target=${TARGET.lat},${TARGET.lng}&t=${TIME}`);
await tab.until('!!window.__scape?.align && !!window.__scapeMap', 60_000);
const S = 'window.__scape';
// The URL the app loaded, so a module import shares its stores.
const imp = (path: string) => `import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '${path}') ?? '${path}')`;
await tab.eval(`(() => { ${S}.settings.getState().update({ terrain: true }); ${S}.world.getState().setPin(${JSON.stringify(PIN)}); ${S}.world.getState().setPin2(${JSON.stringify(TARGET)}); ${S}.world.getState().setTime(${Date.parse(TIME)}); ${S}.align.getState().update({ rangeKm: 10, cells: 64 }); window.__scapeMap.jumpTo({ center: [${PIN.lng}, ${PIN.lat}], zoom: 11, pitch: 0, bearing: 0 }); return true; })()`);
await tab.eval(`(async () => { const ui = await ${imp('/src/lib/state/ui.ts')}; ui.uiStore.getState().setPanelTab('Find'); return true; })()`);
await tab.until(`[...document.querySelectorAll('[aria-label="Heat mode"] button')].length > 0`, 10_000);

for (const mode of MODES) {
  const clicked = await tab.eval<boolean>(`(() => { const b = [...document.querySelectorAll('[aria-label="Heat mode"] button')].find((b) => b.textContent.trim() === '${mode}'); b?.click(); return !!b; })()`);
  const r = await tab.until<{ n: number; finite: number; ms: number; error: string | null } | null>(
    `(() => { const a = ${S}.align.getState(); if (a.error) return { n: 0, finite: 0, ms: 0, error: a.error }; const r = a.result; if (a.computing || !r || r.mode !== '${mode}') return null; let f = 0; for (const v of r.values) if (Number.isFinite(v)) f++; return { n: r.values.length, finite: f, ms: Math.round(r.elapsedMs), error: null }; })()`,
    120_000,
    250
  );
  await Bun.sleep(1000);
  await tab.shot(`${shots}/heat-${mode.toLowerCase()}.png`);
  check(`${mode} heat grid`, clicked && !!r && !r.error && r.n === 64 * 64 && r.finite > 0, r ? (r.error ?? `${r.finite}/${r.n} finite cells in ${r.ms} ms`) : 'no result in 120 s');
}

// A click on the best Align cell picks a candidate there.
await tab.eval(`(() => { [...document.querySelectorAll('[aria-label="Heat mode"] button')].find((b) => b.textContent.trim() === 'Align').click(); ${S}.align.getState().clearCandidate(); return true; })()`);
await tab.until(`(() => { const a = ${S}.align.getState(); return !a.computing && a.result?.mode === 'Align'; })()`, 120_000, 250);
const at = await tab.eval<{ x: number; y: number; lng: number; lat: number; sep: number } | null>(`(async () => {
  const grid = await ${imp('/src/lib/core/geo/grid.ts')};
  const r = ${S}.align.getState().result, m = window.__scapeMap, box = m.getCanvas().getBoundingClientRect();
  let best = -1;
  for (let i = 0; i < r.values.length; i++) {
    const c = grid.cellCentre(r.grid, Math.floor(i / r.grid.n), i % r.grid.n), p = m.project([c.lng, c.lat]);
    if (!Number.isFinite(r.values[i]) || p.x < 60 || p.y < 60 || p.x > box.width - 60 || p.y > box.height - 60 || document.elementFromPoint(box.left + p.x, box.top + p.y) !== m.getCanvas()) continue;
    if (best < 0 || r.values[i] < r.values[best]) best = i;
  }
  if (best < 0) return null;
  const c = grid.cellCentre(r.grid, Math.floor(best / r.grid.n), best % r.grid.n), p = m.project([c.lng, c.lat]);
  return { x: box.left + p.x, y: box.top + p.y, lng: c.lng, lat: c.lat, sep: r.values[best] };
})()`);
let picked: { lng: number; lat: number; sepDeg: number } | null = null;
if (at) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const) await tab.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  picked = await tab.until(`(() => { const c = ${S}.align.getState().candidate; return c && { lng: c.lng, lat: c.lat, sepDeg: c.sepDeg }; })()`, 30_000, 200);
  await Bun.sleep(500);
  await tab.shot(`${shots}/align-pick.png`);
}
check(
  'map click in Align mode picks a candidate',
  !!at && !!picked && Math.abs(picked.lng - at.lng) < 1e-3 && Math.abs(picked.lat - at.lat) < 1e-3 && Number.isFinite(picked.sepDeg),
  at ? (picked ? `cell ${at.sep.toFixed(2)}°, pick ${picked.sepDeg.toFixed(2)}° at ${picked.lat.toFixed(4)},${picked.lng.toFixed(4)}` : 'no candidate') : 'no finite Align cell in view'
);

await tab.eval(`(() => { ${S}.align.getState().update({ mode: 'Off' }); ${S}.align.getState().clearCandidate(); return true; })()`);
await tab.send('Emulation.clearDeviceMetricsOverride', {});
tab.close();
console.log('| Check | Result | Numbers |\n| --- | --- | --- |');
console.log(rows.join('\n'));
process.exit(failed ? 1 : 0);
