// GIBS cache smoke: Offline panel size after a sky reading, Clear behind its confirm, no GIBS traffic until the Night tab asks again, then a refetch; desktop and phone; idle after.
// Usage: bun scripts/smoke/gibscache.ts <cdp> <dev-port> <shot-dir>
/* oxlint-disable no-await-in-loop -- CDP steps are sequential */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Tab } from './cdp';

const [cdp = '9469', port = '5469', shots = '/tmp/gibscache'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });

const SITE = `${BASE}/viewfinder?camera=41.6626,-77.8261&target=41.67,-77.8&t=2026-10-26T21:00Z&f=24`;
const GIBS = 'gibs.earthdata.nasa.gov';
const LINE = /^(\d+) nights? · (\d+) tiles? · (.+)$/;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail.replaceAll('|', '/')} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
const ev = <T>(e: string) => tab.eval<T>(e);
const gibsRequests = () => tab.requests.filter((u) => u.includes(GIBS)).length;
const noSideways = () => ev<boolean>('document.documentElement.scrollWidth <= innerWidth');

let dialogs: string[] = [];
tab.listeners.push((method, p) => {
  if (method !== 'Page.javascriptDialogOpening') return;
  dialogs.push(String(p.message));
  void tab.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
});

const go = async () => {
  await tab.navigate(SITE);
  await tab.until('!!window.__scape?.offline.getState().loaded', 60_000);
};
const setTab = (t: string) => ev(`(() => { const u = window.__scape.ui; u.getState().setPanelTab('${t}'); u.setState({ panelCollapsed: false }); })()`);
const openNight = async () => {
  await setTab('Sky');
  await tab.until(`(() => { const d = document.querySelector('[data-sky]')?.closest('details'); if (!d) return false; d.open = true; d.scrollIntoView({ block: 'start' }); return true; })()`, 10_000, 100);
  const ok = await tab.until(`(() => { const g = window.__scape.skyglow.getState(); return g.camera.status === 'Ready' && g.target.status === 'Ready'; })()`, 120_000);
  await Bun.sleep(500);
  return !!ok;
};
const openOffline = async () => {
  await setTab('Map');
  await tab.until(`(() => { const e = document.querySelector('[data-gibs]'); if (!e) return false; e.scrollIntoView({ block: 'center' }); return true; })()`, 10_000, 100);
  await Bun.sleep(400);
};
const line = () => ev<{ attr: string; text: string; store: number }>(`(() => { const e = document.querySelector('[data-gibs]'); return { attr: e?.dataset.gibs ?? '', text: e?.querySelector('.detail')?.textContent.trim() ?? '', store: window.__scape.offline.getState().gibs.bytes }; })()`);
const opfsHasGibs = () => ev<boolean>(`navigator.storage.getDirectory().then((d) => d.getDirectoryHandle('gibs')).then(() => true, () => false)`);

await tab.viewport(1400, 900);
await tab.fresh(BASE);
await go();
await ev('window.__scape.offline.getState().removeViirs()');

for (const v of [
  { name: 'desktop', w: 1400, h: 900 },
  { name: 'phone', w: 390, h: 844 }
]) {
  await tab.viewport(v.w, v.h);
  await go();

  // 1. A sky reading fills the cache.
  const ready = await openNight();
  await openOffline();
  const before = await line();
  await tab.shot(join(shots, `${v.name}-cached.png`));
  const m = before.text.match(LINE);
  check(`${v.name}: Offline shows the GIBS cache`, ready && !!m && Number(m[1]) > 0 && Number(m[2]) > 0 && Number(before.attr) > 0 && before.store > 0 && (await noSideways()), `${before.text} (${before.attr} B)`);

  // 2. Clear behind a confirm; nothing refetches while the Night tab is closed.
  dialogs = [];
  await tab.logRequests();
  await ev(`setTimeout(() => document.querySelector('[data-gibs] button').click())`);
  const cleared = await tab.until(`document.querySelector('[data-gibs]')?.dataset.gibs === '0'`, 15_000, 100);
  await Bun.sleep(3000);
  const after = await line();
  await tab.shot(join(shots, `${v.name}-cleared.png`));
  const disabled = await ev<boolean>(`document.querySelector('[data-gibs] button').disabled`);
  const status = await ev<string>('window.__scape.skyglow.getState().camera.status');
  check(`${v.name}: Clear asks first`, dialogs.length === 1 && /GIBS|nightly/i.test(dialogs[0]), dialogs[0] ?? 'no dialog');
  check(`${v.name}: cleared reads 0, OPFS emptied`, !!cleared && after.text === '0 nights · 0 tiles · 0 B' && after.store === 0 && disabled && !(await opfsHasGibs()), `${after.text}; button disabled ${disabled}`);
  check(`${v.name}: no GIBS requests until the Night tab opens`, gibsRequests() === 0 && status === 'Idle', `${gibsRequests()} GIBS requests in 3 s, sky ${status}`);

  // 3. The Night tab refetches.
  const again = await openNight();
  const g = await ev<{ camera?: { fetchedTiles: number } }>('window.__scape.skyglow.getState().gibsLast');
  await tab.shot(join(shots, `${v.name}-refetched.png`));
  check(`${v.name}: Night tab refetches`, again && (g.camera?.fetchedTiles ?? 0) > 0 && gibsRequests() > 0, `camera fetched ${g.camera?.fetchedTiles} tiles, ${gibsRequests()} GIBS requests`);
  await openOffline();
  const refilled = await line();
  check(`${v.name}: Offline size back after refetch`, refilled.store > 0 && Number(refilled.attr) > 0, refilled.text);
}

// 4. Idle: no frames, GPU work or requests.
for (const t0 = Date.now(); Date.now() - t0 < 30_000; ) {
  await ev('window.__scape.idle.reset()');
  await Bun.sleep(1000);
  if ((await ev<number>('window.__scape.idle.glDraws')) === 0) break;
}
await ev('window.__scape.idle.reset()');
await tab.logRequests();
await Bun.sleep(3000);
const idle = await ev<{ raf: number; glDraws: number }>('(({ raf, glDraws }) => ({ raf, glDraws }))(window.__scape.idle)');
check('Idle 3 s: 0 rAF, 0 GL draws, 0 requests', idle.raf === 0 && idle.glDraws === 0 && tab.requests.length === 0, `rAF ${idle.raf}, GL draws ${idle.glDraws}, requests ${tab.requests.length}`);

await ev(`navigator.storage.getDirectory().then((d) => d.removeEntry('gibs', { recursive: true })).catch(() => {})`);
console.log('| Check | Result | Detail |');
console.log('|---|---|---|');
console.log(rows.join('\n'));
tab.close();
process.exit(failed ? 1 : 0);
