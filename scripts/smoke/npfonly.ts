// NPF-only smoke: Night panel star rules and sky-missing text, known vs unknown pixel count × no-data vs ready sky × desktop and phone.
// Usage: bun scripts/smoke/npfonly.ts <cdp> <dev-port> <shot-dir> <tile-dir>
/* oxlint-disable no-await-in-loop -- CDP steps are sequential */
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Tab } from './cdp';

const [cdp = '9466', port = '5466', shots = '/tmp/npfonly', tiles = '/tmp/npfonly/tiles'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });
// Rotterdam, inside the synthetic tiles.
const URL = `${BASE}/viewfinder?camera=51.9091,4.4868&target=51.90664,4.48805&t=2026-10-26T21:00Z&f=24`;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail.replaceAll('|', '/')} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
const ev = <T>(e: string) => tab.eval<T>(e);
await tab.fresh(BASE);
await tab.viewport(1400, 900);

const go = async () => {
  await tab.navigate(URL);
  await tab.until('!!window.__scape?.offline.getState().loaded', 60_000);
};
const settle = async (s: string) => {
  const ok = await tab.until(`window.__scape.skyglow.getState().camera.status === '${s}'`, 60_000);
  await Bun.sleep(700);
  return !!ok;
};

await go();
await ev('window.__scape.offline.getState().removeViirs()');
const knownId = await ev<string>(`window.__scape.gear.getState().addCamera({ name: 'Smoke 61 MP', widthMm: 35.7, heightMm: 23.8, pixelsWide: 9504 })`);
const cams = [
  { name: 'known-px', id: knownId },
  { name: 'unknown-px', id: 'ff' }
] as const;
const views = [
  { name: 'desktop', w: 1400, h: 900 },
  { name: 'phone', w: 390, h: 844 }
] as const;

type Read = { stars: string; kv: string; pxInput: boolean; sky: string; missing: string; missingButton: boolean; readout: boolean; panel: string; fits: boolean };
const read = () =>
  ev<Read | null>(`(async () => {
  const u = window.__scape.ui; u.getState().setPanelTab('Sky'); u.setState({ panelCollapsed: false });
  for (let i = 0; i < 40 && !document.querySelector('input[aria-label="Trail duration, minutes"]'); i++) await new Promise((r) => setTimeout(r, 100));
  const st = document.querySelector('input[aria-label="Trail duration, minutes"]')?.closest('details');
  const sk = document.querySelector('[data-sky]')?.closest('details');
  if (!st || !sk) return null;
  st.open = true; sk.open = true;
  await new Promise((r) => setTimeout(r, 300));
  st.scrollIntoView({ block: 'start' });
  const m = document.querySelector('.sky-missing[data-sky="Camera"]');
  return {
    stars: st.querySelector('summary').textContent.trim(),
    kv: st.querySelector('.kv').textContent.replace(/\\s+/g, ' ').trim(),
    pxInput: !!st.querySelector('input[aria-label="Image width in pixels"]'),
    sky: sk.querySelector('summary').textContent.trim(),
    missing: m?.textContent.trim() ?? '',
    missingButton: !!m?.querySelector('button'),
    readout: !!document.querySelector('.sky-readout[data-sky="Camera"]'),
    panel: st.parentElement.textContent,
    fits: document.documentElement.scrollWidth <= innerWidth
  };
})()`);

const run = async (sky: 'NoData' | 'Ready') => {
  for (const v of views) {
    await tab.viewport(v.w, v.h);
    for (const c of cams) {
      await ev(`window.__scape.composition.getState().update({ sensorId: '${c.id}' })`);
      await go();
      const ok = await settle(sky);
      const r = await read();
      await tab.shot(join(shots, `${v.name}-${sky}-${c.name}.png`));
      const tag = `${v.name} ${sky} ${c.name}`;
      if (!r) {
        check(tag, false, 'Night panel groups not found');
        continue;
      }
      const no500 = !/500 rule|500-rule/i.test(r.panel) && !/download/i.test(r.panel);
      const starsOk =
        c.name === 'known-px'
          ? /^NPF \d+\.\d s at 24 mm/.test(r.stars) && /NPF rule ?\d+\.\d s/.test(r.kv) && !r.pxInput
          : r.stars.startsWith('NPF needs the camera or pixel count') && /NPF rule ?needs the pixel count/.test(r.kv) && r.pxInput;
      const skyOk = sky === 'NoData' ? r.sky === 'Sky brightness · no data here' && /^no sky data here( · .+)? · More on DarkHours$/.test(r.missing) && !r.missingButton : r.readout && r.sky.startsWith('Sky ≈ ');
      check(tag, ok && no500 && starsOk && skyOk && r.fits, `stars "${r.stars}" · sky "${r.sky}"${r.missing ? ` · "${r.missing}"` : ''} · fits ${r.fits}${no500 && starsOk && skyOk ? '' : ` · no500 ${no500} stars ${starsOk} sky ${skyOk} · ok ${ok} · kv "${r.kv}"`}`);
    }
  }
  await tab.viewport(1400, 900);
};

await run('NoData');

// Import the synthetic tiles through the Offline file input.
await ev(`window.__scape.ui.getState().setPanelTab('Map')`);
await tab.until(`!!document.querySelector('input[aria-label="Import VNP46A4 tiles"]')`, 20_000);
const files = readdirSync(tiles)
  .filter((f) => f.endsWith('.h5'))
  .map((f) => join(tiles, f));
const input = (await tab.send('Runtime.evaluate', { expression: `document.querySelector('input[aria-label="Import VNP46A4 tiles"]')` })) as { result: { objectId?: string } };
if (input.result.objectId) await tab.send('DOM.setFileInputFiles', { files, objectId: input.result.objectId });
const imported = await tab.until<boolean>(`window.__scape.offline.getState().viirs.tiles.length >= ${files.length}`, 120_000);
check('Offline tile import still works', !!imported, `${files.length} files`);

await run('Ready');

await ev('window.__scape.offline.getState().removeViirs()');
await ev(`window.__scape.gear.getState().removeCamera('${knownId}')`);
console.log('| Check | Result | Detail |');
console.log('|---|---|---|');
console.log(rows.join('\n'));
tab.close();
process.exit(failed ? 1 : 0);
