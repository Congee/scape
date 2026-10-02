// CDP half of rescorefix.sh: panel controls ≥ 24 px at 1600 and ≥ 44 px coarse at 390; a touch drag reaches the tall sheet; Weather has one cloud chart, tide chart and credit.
// Usage: bun scripts/smoke/rescorefix-touch.ts <cdp> <port> <query>; prints table rows, exits 1 on a failure.
/* oxlint-disable no-await-in-loop -- tab steps are sequential */
import { Tab } from './cdp';
import { OpenMeteoStub } from './weather-stub';

const [cdp, port, query] = process.argv.slice(2);
const base = `http://localhost:${port}`;
const tab = await Tab.open(Number(cdp), base);

let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
};
const sleep = (ms: number) => Bun.sleep(ms);
// Checkboxes, radios and file inputs count by their label, which is the hit area.
const MEASURE = `((min) => {
  const els = [...document.querySelector('.panel').querySelectorAll('button, input, select, textarea, summary, a[href], [role=radio], [tabindex]:not([tabindex="-1"])')];
  const bad = [];
  for (const e of els) {
    const r0 = e.getBoundingClientRect();
    if (!r0.width || !r0.height || !e.checkVisibility()) continue;
    const lab = e.closest('label');
    const t = lab && /^(checkbox|radio|file)$/.test(e.type) ? lab : e;
    const r = t.getBoundingClientRect();
    if (r.width < min - 0.5 || r.height < min - 0.5) bad.push(e.tagName.toLowerCase() + '|' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 18) + '|' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return bad.length + (bad.length ? ': ' + bad.slice(0, 6).join(' ; ') : '');
})`;
const setTab = async (t: string) => {
  await tab.eval(`(() => { const u = __scape.ui.getState(); u.setPanelTab('${t}'); u.setPanelCollapsed(false); u.setPanelTall(false); return 1; })()`);
  await sleep(600);
  await tab.eval(`(() => { document.querySelectorAll('#ptabpanel details').forEach((d) => (d.open = true)); return 1; })()`);
  await sleep(300);
};
const go = async (path: string) => {
  await tab.navigate(`${base}${path}?${query}`);
  await tab.until('!!(window.__scape && document.querySelector("[role=tablist]"))', 20_000, 250);
  await sleep(1500);
};

for (const [name, w, h, min, coarse] of [
  ['1600', 1600, 1000, 24, false],
  ['390 coarse', 390, 844, 44, true]
] as const) {
  await tab.viewport(w, h);
  await tab.send('Emulation.setTouchEmulationEnabled', coarse ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  for (const [page, path, tabs] of [
    ['map', '/', ['Now', 'Shot', 'Sky', 'Find', 'Weather', 'Map', 'Markers']],
    ['viewfinder', '/viewfinder', ['Now', 'Shot', 'Sky', 'Find', 'Weather', 'View', 'Markers']]
  ] as const) {
    await go(path);
    if (coarse) check(`${page} ${name}: pointer is coarse`, await tab.eval<boolean>("matchMedia('(pointer: coarse)').matches"), 'matchMedia');
    const bad: string[] = [];
    for (const t of tabs) {
      await setTab(t);
      const r = await tab.eval<string>(`${MEASURE}(${min})`);
      if (r !== '0') bad.push(`${t} ${r}`);
    }
    check(`${page} ${name}: targets ≥ ${min} px`, bad.length === 0, bad.join(' / ') || 'all tabs');
  }
}

// Still coarse at 390: drag the handle up twice, open then tall.
await go('/');
await setTab('Now');
await tab.eval('(() => { __scape.ui.getState().setPanelCollapsed(true); return 1; })()');
await sleep(300);
await tab.eval('(() => { __scape.ui.getState().setPanelCollapsed(false); return 1; })()');
await sleep(400);
const handle = () => tab.eval<{ x: number; y: number }>('(() => { const r = document.querySelector(".sheet-handle").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()');
const h0 = await tab.eval<number>('Math.round(document.querySelector(".panel").getBoundingClientRect().height)');
const { x, y } = await handle();
const touch = (type: string, ty?: number) => tab.send('Input.dispatchTouchEvent', { type, touchPoints: ty === undefined ? [] : [{ x, y: ty, id: 0 }] });
await touch('touchStart', y);
for (let i = 1; i <= 8; i++) {
  await touch('touchMove', y - i * 10);
  await sleep(20);
}
await touch('touchEnd');
await sleep(500);
const tall = await tab.eval<string>('`${document.querySelector(".map-page").classList.contains("panel-tall")} ${Math.round(document.querySelector(".panel").getBoundingClientRect().height)}`');
check('390 sheet: drag up reaches tall', tall.startsWith('true ') && Number(tall.split(' ')[1]) > h0, `tall ${tall} px (open ${h0} px)`);
await tab.eval('(() => { __scape.ui.getState().setPanelTall(false); return 1; })()');

await tab.send('Emulation.setTouchEmulationEnabled', { enabled: false });

// At a harmonic tide station, with Open-Meteo on the fixture so a rate limit can't blank the charts.
await new OpenMeteoStub(tab).install();
await tab.viewport(1600, 1000);
const day = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
await tab.navigate(`${base}/?camera=40.7003,-74.0150&t=${day}T15:00Z`);
await tab.until('!!(window.__scape && document.querySelector("[role=tablist]"))', 20_000, 250);
await tab.eval('(() => { __scape.settings.getState().update({ weather: true }); return 1; })()');
await setTab('Weather');
await tab.until('!!(document.querySelector("#ptabpanel .tide-curve") && document.querySelector("#ptabpanel .cloud-chart"))', 20_000, 250);
const wx = await tab.eval<string>('(() => { const p = document.querySelector("#ptabpanel"); return [".cloud-chart", ".tide-curve", ".wx-credit"].map((s) => p.querySelectorAll(s).length).join(" "); })()');
check('Weather: one cloud chart, tide chart and credit', wx === '1 1 1', `${wx} (cloud, tide, credit)`);
tab.close();
process.exit(failed ? 1 : 0);
