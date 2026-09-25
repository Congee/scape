// Bad LoD2 tile smoke: the mask worker's first two Rotterdam tiles are served as a 404 and as junk; across mask rebuilds each warns once and is fetched once, on desktop and phone.
/* oxlint-disable no-await-in-loop -- smoke steps run one rebuild at a time */
// Usage: bun scripts/smoke/lod2-badtile.ts <cdp> <dev-port> <shot-dir>
import { Tab } from './cdp';

const [cdp = '9402', port = '5402', shots = '/tmp/lod2-badtile'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const MASK = 'buildings-mask';
const REBUILDS = 4;
const URL_MAP = `${BASE}/?camera=51.9091,4.4868&target=51.90664,4.48805&t=2026-06-21T13:00Z&z=16.5`;
const SETTINGS = `(() => { window.__scape.settings.getState().update({ terrain: true, showSunShadows: true, lightSource: 'Auto' }); window.__scape.composition.getState().update({ showBuildings: true }); return true; })()`;
const READY = `(() => { const b = window.__scape?.buildings.getState(); return !!(window.__scapeMap && b && b.shadowMask && !b.busy); })()`;
// Distinct mask grids the page received; a sun change alone reuses the grid and is not a rebuild.
const COUNT = `(() => { if (!window.__maskKeys) { window.__maskKeys = new Set(); const add = (m) => m && window.__maskKeys.add(\`\${m.centre.lat},\${m.centre.lng},\${m.originE},\${m.originN}\`); add(window.__scape.buildings.getState().shadowMask); window.__scape.buildings.subscribe((s) => add(s.shadowMask)); } return window.__maskKeys.size; })()`;
const CONTENT = /\.(glb|b3dm)(\?|$)/;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE, { front: false });
await tab.fresh(BASE);

const names = new Map<string, Promise<string>>();
const nameOf = (sid: string) => {
  let n = names.get(sid);
  if (!n) {
    n = tab.send('Runtime.evaluate', { expression: 'self.name', returnByValue: true }, sid).then((r) => String((r as { result: { value: unknown } }).result.value));
    names.set(sid, n);
  }
  return n;
};
let gone: string | null = null;
let junk: string | null = null;
/** Fetches per URL; on the map only the mask worker fetches LoD2. */
const hits = new Map<string, number>();
const warnings: { worker: string; text: string; url: string }[] = [];

// Fetch.enable on a worker session never answers; the page's own interception sees its workers' requests.
tab.workerSetup.push((sid) => tab.send('Runtime.enable', {}, sid));
await tab.send('Fetch.enable', { patterns: [{ urlPattern: '*3dbag.nl*' }] });
tab.listeners.push((method, params, sid) => {
  if (method === 'Fetch.requestPaused') void paused(params as { requestId: string; request: { url: string } }).catch(() => {});
  if (method === 'Runtime.consoleAPICalled' && sid && params.type === 'warning') {
    const args = (params.args as { value?: unknown }[]).map((a) => String(a.value ?? ''));
    if (args[0]?.startsWith('[scape] LoD2')) void nameOf(sid).then((worker) => warnings.push({ worker, text: args[0], url: args[1] ?? '' }));
  }
});

async function paused(p: { requestId: string; request: { url: string } }) {
  const url = p.request.url;
  if (CONTENT.test(url)) {
    gone ??= url;
    if (url !== gone) junk ??= url;
  }
  hits.set(url, (hits.get(url) ?? 0) + 1);
  // Without CORS the page sees a network error, which is transient.
  const responseHeaders = [{ name: 'Access-Control-Allow-Origin', value: '*' }];
  if (url === gone) await tab.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 404, responseHeaders, body: '' });
  else if (url === junk) await tab.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders, body: Buffer.from('not a tile, not a glb').toString('base64') });
  else await tab.send('Fetch.continueRequest', { requestId: p.requestId });
}

/** One page load, so the mask worker starts with no failures remembered. */
async function pass(label: string, width: number, height: number) {
  gone = junk = null;
  hits.clear();
  warnings.length = 0;
  await tab.viewport(width, height);
  await tab.navigate(URL_MAP);
  await tab.until(`!!window.__scape && ${SETTINGS}`, 30_000);
  const first = await tab.until(READY, 120_000);
  check(`${label}: first mask built`, !!first && gone !== null && junk !== null, `victims ${gone ?? 'none'} (404), ${junk ?? 'none'} (junk)`);

  let built = await tab.eval<number>(COUNT);
  const start = built;
  for (let i = 0; i < REBUILDS; i++) {
    // Small pans move the mask grid but keep the nearest tiles in it.
    await tab.eval(`(window.__scapeMap.panBy([${i % 2 ? -120 : 180}, ${i % 2 ? 90 : -60}], { animate: false }), true)`);
    await tab.until(`${COUNT} > ${built} && ${READY}`, 90_000);
    built = await tab.eval<number>(COUNT);
  }
  await Bun.sleep(1000);
  await tab.shot(`${shots}/map-badtile-${width}x${height}.png`);
  const rebuilds = built - start;
  const lod2 = await tab.eval<number>('window.__scape.buildings.getState().shadowMask?.lod2.length ?? -1');
  check(`${label}: ≥3 mask rebuilds`, rebuilds >= 3, `${rebuilds} rebuilds after the first, mask LoD2 sources ${lod2}`);
  check(`${label}: the other tiles still stamp LoD2`, lod2 > 0, `${lod2} LoD2 sources in the mask`);
  for (const [kind, url] of [['404', gone], ['junk', junk]] as const) {
    if (!url) continue;
    const n = hits.get(url) ?? 0;
    const w = warnings.filter((x) => x.worker === MASK && x.url === url);
    check(`${label}: ${kind} tile fetched once by the mask worker`, n === 1, `${n} fetches across ${rebuilds + 1} masks`);
    check(`${label}: ${kind} tile warned once by the mask worker, as permanent`, w.length === 1 && w[0].text.includes('skipped'), `${w.length} warnings: ${w.map((x) => x.text).join(' / ') || 'none'}`);
  }
  const others = warnings.filter((x) => x.url !== gone && x.url !== junk);
  check(`${label}: no other LoD2 warnings`, others.length === 0, others.map((x) => `${x.worker} ${x.text} ${x.url}`).join('; ') || 'none');
}

await pass('map NL', 1400, 900);
await pass('map NL phone', 390, 844);

tab.close();
console.log(rows.join('\n'));
process.exit(failed > 0 ? 1 : 0);
