// Worker memory smoke: the Alpenglow card and the light probe answer the same after their idle workers are terminated and come back,
// and viewfinder → map → viewfinder drops the mesh pool and still renders.
// Usage: bun scripts/smoke/workermem.ts <cdp> <port>
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
import { Tab } from './cdp';

const [cdp = '9488', port = '5488'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const CAMERA = { lat: 46.0207, lng: 7.7491 };
const TARGET = { lat: 45.9763, lng: 7.6586 };
const PROBE = { lat: 46.0935, lng: 7.7756 };
// WORKER_IDLE_MS plus slack.
const IDLE_WAIT_MS = 90_000;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

// Names each worker after the state module that spawned it.
const NAME_WORKERS = `(() => {
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(url, opts = {}) {
      const at = /\\/src\\/lib\\/(?:state|data)\\/(\\w+)\\.ts/.exec(new Error().stack ?? '');
      super(url, opts.name ? opts : { ...opts, name: at ? at[1] : 'other' });
    }
  };
})()`;

const tab = await Tab.open(Number(cdp), BASE);
await tab.fresh(BASE);
await tab.viewport(1400, 900, 2);
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: NAME_WORKERS });

/** Live workers by name, with what their dev hooks expose. */
async function workers(): Promise<{ name: string; mesh: { pool: number; blocks: number } | null }[]> {
  const got = await Promise.all(
    tab.workerSessions().map(async ([s]) => {
      try {
        const r = (await tab.send('Runtime.evaluate', { expression: '({ name: self.name, mesh: self.__scapeMesh ? { pool: self.__scapeMesh.pool.bytes, blocks: self.__scapeMesh.blocks.bytes } : null })', returnByValue: true }, s, 5000)) as {
          result: { value: { name: string; mesh: { pool: number; blocks: number } | null } };
        };
        return r.result.value;
      } catch {
        return null;
      }
    })
  );
  return got.filter((x) => !!x);
}
const alive = async (name: string) => (await workers()).some((w) => w.name === name);

/** Polls a script-side check until it is truthy or the time runs out. */
async function poll<T>(f: () => Promise<T | null | false>, ms: number, everyMs: number): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) return null;
    await Bun.sleep(everyMs);
  }
}
const js = <T = unknown>(e: string) => tab.eval<T>(e);
const until = (e: string, ms = 120_000) => tab.until(e, ms, 250);
const GLOW = `(() => { const g = document.querySelector('details[data-card=alpenglow] .glow'); if (!g) return ''; return JSON.stringify({ status: g.dataset.glow, rows: [...g.querySelectorAll('[data-glow-event]')].map((li) => [li.dataset.glowEvent, li.dataset.day, li.dataset.score]) }); })()`;
const PROBE_LIGHT = `(() => { const p = window.__scape.lightProbe.getState(); return !p.busy && p.horizon?.refined && p.light ? JSON.stringify({ first: p.light.first, last: p.light.last, ground: p.horizon.groundM }) : p.error ? 'error ' + p.error : ''; })()`;
const toggleGlow = () => js('document.querySelector("details[data-card=alpenglow] > summary[data-glow-toggle]").click(), 1');
const rail = async (href: string) => {
  await js(`document.querySelector('a.rail-link[href^="${href}"]').click(), 1`);
  await until(href === '/' ? '!!document.querySelector(".maplibregl-canvas") && !document.querySelector("canvas.vf")' : '!!document.querySelector("canvas.vf")', 30_000);
};

await tab.navigate(`${BASE}/?camera=${CAMERA.lat},${CAMERA.lng}&target=${TARGET.lat},${TARGET.lng}&z=12&t=2026-06-21T13:00Z`);
await until('!!(window.__scape && document.querySelector(".maplibregl-canvas"))', 30_000);
await js('(() => { const s = window.__scape; s.settings.getState().update({ weather: true }); const u = s.ui.getState(); u.setPanelTab("Weather"); u.setPanelCollapsed(false); return 1; })()');
await until('!!document.querySelector("details[data-card=alpenglow] > summary[data-glow-toggle]")', 30_000);

// First answers.
await toggleGlow();
const glow1 = (await until<string>(GLOW)) ?? '';
check('Alpenglow answers', !!glow1, glow1.slice(0, 120));
await js(`window.__scape.lightProbe.getState().setPoint(${JSON.stringify(PROBE)}), 1`);
const light1 = (await until<string>(PROBE_LIGHT)) ?? '';
check('light probe answers', !!light1 && !light1.startsWith('error'), light1);
check('both point workers live while in use', (await alive('glowPoint')) && (await alive('lightProbe')), (await workers()).map((w) => w.name).join(', '));

// Idle: both workers go.
await toggleGlow();
const t0 = Date.now();
const gone = !!(await poll(async () => !(await alive('glowPoint')) && !(await alive('lightProbe')), IDLE_WAIT_MS, 2000));
check('idle point workers terminate', gone, `${((Date.now() - t0) / 1000).toFixed(0)} s; live: ${(await workers()).map((w) => w.name).join(', ')}`);

// They come back and answer the same.
await toggleGlow();
const glow2 = (await until<string>(`(() => { const v = ${GLOW}; return v && !document.querySelector('[data-glow=loading]') ? v : ''; })()`)) ?? '';
check('Alpenglow answers the same through a new worker', glow2 === glow1 && (await alive('glowPoint')), glow2.slice(0, 120));
await js('window.__scape.lightProbe.getState().setPoint(null), 1');
await js(`window.__scape.lightProbe.getState().setPoint(${JSON.stringify(PROBE)}), 1`);
const light2 = (await until<string>(PROBE_LIGHT)) ?? '';
check('light probe answers the same through a new worker', light2 === light1 && (await alive('lightProbe')), light2);
await toggleGlow();
await js('(() => { window.__scape.lightProbe.getState().setPoint(null); window.__scape.ui.getState().setPanelTab("Plan"); return 1; })()');

// Viewfinder → map → viewfinder.
const VF_SETTLED = `(() => { const S = window.__scape, t = S.terrain.getState(), p = S.prism; return !t.busy.Mesh && !t.busy.View && t.mesh.length > 0 && t.mesh.length === t.mesh[0].levels && !!p?.terrain && p.terrain.levels === t.mesh.length; })()`;
const meshOf = async () => (await workers()).find((w) => w.name === 'terrain')?.mesh ?? null;
await rail('/viewfinder');
check('viewfinder renders', !!(await until(VF_SETTLED)), `levels ${await js('window.__scape.terrain.getState().mesh.length')}`);
const inVf = await meshOf();
await rail('/');
const left = await poll(async () => {
  const m = await meshOf();
  return m && m.pool === 0 && m.blocks === 0 ? m : null;
}, 5000, 250);
const mb = (n: number) => (n / 2 ** 20).toFixed(1);
check('leaving the viewfinder drops the mesh pool and blocks', !!left, `in viewfinder pool ${mb(inVf?.pool ?? 0)} MB, blocks ${mb(inVf?.blocks ?? 0)} MB → ${left ? '0 / 0' : JSON.stringify(await meshOf())}`);
await rail('/viewfinder');
check('viewfinder renders again', !!(await until(VF_SETTLED)), `levels ${await js('window.__scape.terrain.getState().mesh.length')}, prism levels ${await js('window.__scape.prism?.terrain?.levels')}`);

tab.close();
console.log('| check | result | detail |\n|---|---|---|');
console.log(rows.join('\n'));
process.exit(failed ? 1 : 0);
