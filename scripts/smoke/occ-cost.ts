// Per-frame CPU in building occlusion queries while dragging the aim, for the phase-0 cases.
/* oxlint-disable no-await-in-loop -- input steps are paced one frame at a time */
// Usage: bun scripts/smoke/occ-cost.ts <cdp> <dev-port> <case,...> [lock-dir]
import { Tab } from './cdp';

const [cdp = '9436', port = '5436', list = 'hoboken', lock = ''] = process.argv.slice(2);
const DAY_NY = '2026-06-21T17:00Z';
const NIGHT_NY = '2026-06-22T04:00Z';
const DAY_NL = '2026-06-21T13:00Z';
const NIGHT_NL = '2026-06-21T23:45Z';
const Places: Record<string, { cam: string; tgt: string; day: string; night: string }> = {
  hoboken: { cam: '40.7450,-74.0300', tgt: '40.7527,-73.9772', day: DAY_NY, night: NIGHT_NY },
  manhattan: { cam: '40.7549,-73.9840', tgt: '40.7484,-73.9857', day: DAY_NY, night: NIGHT_NY },
  rotterdam: { cam: '51.9091,4.4868', tgt: '51.90664,4.48805', day: DAY_NL, night: NIGHT_NL }
};
const READY = '(() => { const p = window.__scape?.prism; return !!p && p.buildings > 0 && !window.__scape.buildings.getState().busy && !(p.lod2 && p.lod2.busy); })()';

const tab = await Tab.open(Number(cdp), `http://localhost:${port}`);
await tab.viewport(3309, 1735, 1.818);
const take = async () => {
  if (!lock) return;
  for (;;) {
    try {
      (await import('node:fs')).mkdirSync(lock);
      return;
    } catch {
      await Bun.sleep(30_000);
    }
  }
};
const give = async () => lock && (await import('node:fs')).rmdirSync(lock);

for (const c of list.split(',')) {
  const [place, focal, when, extra] = c.split(':');
  const p = Places[place];
  await tab.navigate(`http://localhost:${port}/viewfinder?camera=${p.cam}&target=${p.tgt}&t=${when === 'night' ? p.night : p.day}&f=${focal}`);
  if (!(await tab.until(READY, 180_000, 500))) throw new Error(`${c}: not ready`);
  // "all": every sky overlay on, the worst case for query count.
  if (extra === 'all') await tab.eval('window.__scape.composition.getState().update({ showConstellations: true, showTrails: true })');
  await Bun.sleep(4000);
  await take();
  try {
    await tab.eval('window.__occ = []');
    // Aim panned through the store each frame: the same draws a drag makes, without pointer events a background tab may drop.
    await tab.eval(`(async () => { const c = window.__scape.composition.getState(); const az = c.azimuthDeg, el = c.elevationDeg; for (let i = 0; i < 180; i++) { window.__scape.composition.getState().aim(az + 3 * Math.sin(i / 20) * (24 / c.focalMm), el + 0.5 * Math.sin(i / 33) * (24 / c.focalMm)); await new Promise((r) => requestAnimationFrame(r)); } return 1; })()`, 60_000);
    await Bun.sleep(300);
  } finally {
    await give();
  }
  const r = await tab.eval<Record<string, unknown>>(`(() => { const a = window.__occ ?? []; const ms = a.map((x) => x.ms).sort((x, y) => x - y); const q = (f) => ms.length ? +ms[Math.min(ms.length - 1, Math.floor(f * ms.length))].toFixed(2) : -1; const n = a.map((x) => x.n).sort((x, y) => x - y); return { frames: a.length, n50: n[n.length >> 1] ?? 0, hid50: a.map((x) => x.hid).sort((x, y) => x - y)[a.length >> 1] ?? 0, p50: q(0.5), p95: q(0.95), max: q(1), buildings: window.__scape.prism.buildings, lod2: window.__scape.prism.lod2?.tiles ?? 0 }; })()`);
  console.log(JSON.stringify({ case: c, ...r }));
}
tab.close();
