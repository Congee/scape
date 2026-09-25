// First-light smoke: Tools › Light at a point on a 3000 m summit agrees with the alpenglow windows and beats a sea-level observer, desktop and phone.
// Usage: bun scripts/smoke/firstlight.ts <cdp> <dev-port> <screenshot-dir>
import { mkdirSync } from 'node:fs';
import { Tab } from './cdp';

const [cdp, port, out] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
// Jungfrau's south-east ridge, near 3500 m.
const POINT = { lat: 46.5475, lng: 7.9625 };
mkdirSync(out, { recursive: true });

const rows: string[] = [];
let fails = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) fails++;
  console.error(ok ? 'PASS' : 'FAIL', name, detail);
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail.replace(/\|/g, '/').replace(/\s+/g, ' ')} |`);
};

const tab = await Tab.open(Number(cdp), BASE);
const js = <T = string>(e: string) => tab.eval<T>(e);

interface Probe {
  groundM: number;
  first: number | null;
  last: number | null;
  shown: string;
  glowStart: number | null;
  glowEnd: number | null;
  seaFirst: number | null;
  seaLast: number | null;
}

async function run(vp: 'desktop' | 'phone') {
  await tab.send('Emulation.setDeviceMetricsOverride', vp === 'phone' ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } : { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
  await tab.navigate(`${BASE}/`);
  await tab.until('window.__scape && document.querySelector(".tabs button")', 30_000, 250);
  // Midsummer noon, so the day's first and last light both fall inside it.
  await js(`(() => { const s = window.__scape; s.world.getState().setTz('Europe/Zurich'); s.world.getState().setTime(Date.UTC(2026, 5, 21, 11)); const u = s.ui.getState(); u.setPanelTab('Tools'); u.setPanelCollapsed(false); s.lightProbe.getState().setPoint(${JSON.stringify(POINT)}); return 1; })()`);
  await tab.until('window.__scape.lightProbe.getState().light', 120_000, 250);
  await js('(() => { document.querySelectorAll(".tools details").forEach((d) => { d.open = true; }); document.querySelector("[data-probe=first]")?.scrollIntoView({ block: "center" }); return 1; })()');
  const p = await js<Probe>(`(async () => {
    const [{ glowDay }, { makeObserver }, { dayCurve }, { firstLastLight }, { dayBounds }, { lightPointObserver }] = await Promise.all(['/src/lib/core/astro/alpenglow.ts', '/src/lib/core/astro/bodies.ts', '/src/lib/core/astro/dayCurve.ts', '/src/lib/core/astro/lightSource.ts', '/src/lib/core/time/localDay.ts', '/src/lib/state/lightProbe.ts'].map((m) => import(m)));
    const s = window.__scape, pr = s.lightProbe.getState(), w = s.world.getState(), h = pr.horizon;
    const b = dayBounds(new Date(w.time), w.tz), a = b.start.getTime(), e = b.end.getTime();
    const g = glowDay(lightPointObserver(pr.point, h), h.profile, a, e, 30);
    const sea = makeObserver(pr.point, 0), l0 = firstLastLight(sea, dayCurve(sea, a, e), h.profile, e, a);
    return { groundM: h.groundM, first: pr.light.first, last: pr.light.last, shown: document.querySelector('[data-probe=first]')?.textContent ?? '', glowStart: g.sunrise?.startMs ?? null, glowEnd: g.sunset?.endMs ?? null, seaFirst: l0.first, seaLast: l0.last };
  })()`);
  check(`${vp}: point stands high`, p.groundM > 2500, `ground ${Math.round(p.groundM)} m`);
  check(`${vp}: first light shown`, p.first !== null && /^\d{1,2}:\d\d/.test(p.shown), p.shown);
  check(`${vp}: alpenglow windows start and end at first and last light`, p.glowStart === p.first && p.glowEnd === p.last, `Δ ${(p.glowStart! - p.first!) / 1000} s / ${(p.glowEnd! - p.last!) / 1000} s`);
  check(`${vp}: ground-height eye differs from a sea-level one`, p.seaFirst !== null && p.first !== p.seaFirst, `same skyline: first light ${(p.first! - p.seaFirst!) / 1000} s later, last ${(p.seaLast! - p.last!) / 1000} s sooner than a sea-level eye`);
  const wide = await js<boolean>('document.documentElement.scrollWidth > window.innerWidth');
  check(`${vp}: no sideways scroll`, !wide, `overflow ${wide}`);
  await tab.shot(`${out}/${vp}.png`);
}

await run('desktop');
await run('phone');

await tab.send('Emulation.clearDeviceMetricsOverride');
tab.close();
console.log('| Check | Result | Detail |');
console.log('|---|---|---|');
console.log(rows.join('\n'));
console.log(`Screenshots: ${out}`);
process.exit(fails ? 1 : 0);
