// Prism worker smoke: main-thread cost of a building drag, occlusion answers pinned against a reference, stills and a phone viewport.
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
// Usage: bun scripts/smoke/prismworker.ts <cdp> <dev-port> <shot-dir> [gpu-lock-dir|-] [measure|occ|stills|all] [reference-occ.json|-]
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { Tab } from './cdp';

const [cdp = '9464', port = '5464', shots = '/tmp/prismworker', lock = '-', mode = 'all', ref = '-'] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });

const SCENES: Record<string, { camera: string; target: string; day: string; night: string }> = {
  // De Rotterdam from the Maas: Overture prisms around 3DBAG LoD2.
  rotterdam: { camera: '51.9091,4.4868', target: '51.90664,4.48805', day: '2026-06-21T13:00Z', night: '2026-06-21T23:45Z' },
  // Midtown towards the Empire State Building.
  manhattan: { camera: '40.7549,-73.9840', target: '40.7484,-73.9857', day: '2026-06-21T17:00Z', night: '2026-06-22T04:00Z' }
};
const FOCALS = [24, 200, 600, 2400];
const DRAG_MS = 5000;
/** Functions whose inclusive main-thread time the report breaks out. */
const ENTRIES = ['prismSurfaces', 'upload', 'tileMesh', 'occludes', 'occluder', 'PrismOccluder', 'MeshOccluder', 'prismSlots', 'adoptPrismSlots', 'buildPrisms', 'drawSceneGl', 'draw'];
const READY = '(() => { const S = window.__scape; const p = S?.prism; const t = S?.terrain?.getState(); return !!p && p.buildings > 0 && !S.buildings.getState().busy && !(p.lod2 && p.lod2.busy) && !!t && !t.busy.Mesh && !t.busy.View; })()';

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
await tab.fresh(BASE);
await tab.viewport(1400, 900);

const url = (s: string, f: number, o: 'l' | 'p', time: 'day' | 'night') => `${BASE}/viewfinder?camera=${SCENES[s].camera}&target=${SCENES[s].target}&t=${SCENES[s][time]}&f=${f}${o === 'p' ? '&o=p' : ''}`;
const go = async (u: string) => {
  await tab.eval("try { localStorage.removeItem('scape.composition') } catch {}");
  await tab.navigate(u);
  await tab.until('!!(window.__scape && document.querySelector("canvas.vf"))', 30_000, 250);
  await tab.eval('(() => { window.__scape.settings.getState().update({ terrain: true }); window.__scape.composition.getState().update({ showBuildings: true, showStars: true }); return 1; })()');
  if ((await tab.eval<string>('document.visibilityState')) !== 'visible') throw new Error('smoke tab is hidden');
};
const settle = async () => {
  const ok = await tab.until(READY, 180_000, 250);
  await Bun.sleep(1500);
  return !!ok && (await tab.eval<boolean>(READY));
};
const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (lock !== '-')
    for (;;) {
      try {
        mkdirSync(lock);
        break;
      } catch {
        console.error('waiting for the GPU timing lock');
        await Bun.sleep(30_000);
      }
    }
  try {
    return await fn();
  } finally {
    if (lock !== '-') rmdirSync(lock);
  }
};

/** Main-thread sampling profile over `fn`: busy ms and inclusive ms per entry. */
async function profiled(fn: () => Promise<void>, tag: string): Promise<{ busy: number; incl: Map<string, number> }> {
  await tab.send('Profiler.enable');
  await tab.send('Profiler.setSamplingInterval', { interval: 250 });
  await tab.send('Profiler.start');
  await fn();
  const { profile } = (await tab.send('Profiler.stop')) as { profile: { nodes: { id: number; callFrame: { functionName: string }; children?: number[] }[]; samples: number[]; timeDeltas: number[] } };
  writeFileSync(`${shots}/${tag}.cpuprofile`, JSON.stringify(profile));
  const fnOf = new Map(profile.nodes.map((n) => [n.id, n.callFrame.functionName || '(anon)']));
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const incl = new Map<string, number>();
  let busy = 0;
  profile.samples.forEach((id, i) => {
    const f = fnOf.get(id) ?? '?';
    const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    if (f === '(idle)' || f === '(program)' || f === '(garbage collector)') {
      if (f === '(garbage collector)') incl.set('(gc)', (incl.get('(gc)') ?? 0) + dt);
      if (f !== '(garbage collector)') return;
    }
    busy += dt;
    const seen = new Set<string>();
    for (let n: number | undefined = id; n != null; n = parent.get(n)) seen.add(fnOf.get(n) ?? '?');
    for (const e of ENTRIES) if (seen.has(e)) incl.set(e, (incl.get(e) ?? 0) + dt);
  });
  return { busy, incl };
}

/** A 5 s pointer pan across the frame with a slow tilt wave, held 300 ms each second. */
async function drag(f: { x: number; y: number; w: number; h: number }) {
  const x0 = f.x + f.w * 0.8;
  const y0 = f.y + f.h / 2;
  const at = (t: number) => {
    const moving = Math.floor(t / 1000) * 700 + Math.min(t % 1000, 700);
    return { x: x0 - (moving / (DRAG_MS * 0.7)) * f.w * 0.6, y: y0 + Math.sin((moving / 1750) * 2 * Math.PI) * f.h * 0.05, held: t % 1000 >= 700 };
  };
  const mouse = (type: string, x: number, y: number) => tab.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
  await mouse('mousePressed', x0, y0);
  const t0 = performance.now();
  for (;;) {
    const t = performance.now() - t0;
    if (t > DRAG_MS) break;
    const p = at(t);
    if (!p.held) await mouse('mouseMoved', p.x, p.y);
    await Bun.sleep(8);
  }
  const end = at(DRAG_MS);
  await mouse('mouseReleased', end.x, end.y);
}

const FRAME = '(() => { const r = document.querySelector("canvas.vf").getBoundingClientRect(), f = window.__scape.prism.cam.frame; return { x: r.left + f.x, y: r.top + f.y, w: f.w, h: f.h }; })()';
const LONG = '(() => { window.__long = []; if (window.__longObs) window.__longObs.disconnect(); window.__longObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }); window.__longObs.observe({ type: "longtask" }); return 1; })()';

// Every document records its long tasks from the start.
await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: LONG });
const table = ['| scene | mm | main busy ms/s | prismSurfaces ms/s | upload ms/s | occludes ms/s | occluder ms/s | gc ms/s | long tasks | long ms/s | max long ms | tiles in |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
if (mode === 'measure' || mode === 'all')
  for (const s of ['rotterdam', 'manhattan'])
    for (const f of [24, 200]) {
      await go(url(s, f, 'l', 'day'));
      if (!(await settle())) {
        check(`${s} ${f}mm settles`, false, 'never settled');
        continue;
      }
      const frame = await tab.eval<{ x: number; y: number; w: number; h: number }>(FRAME);
      const v0 = await tab.eval<number>('window.__scape.buildings.getState().version');
      await tab.eval(LONG);
      const { secs, cpu } = await withLock(async () => {
        const w0 = performance.now();
        const prof = await profiled(() => drag(frame), `profile-${s}-${f}`);
        return { secs: (performance.now() - w0) / 1000, cpu: prof };
      });
      const long = await tab.eval<number[]>('window.__long');
      const v1 = await tab.eval<number>('window.__scape.buildings.getState().version');
      const r = (k: string) => ((cpu.incl.get(k) ?? 0) / secs).toFixed(0);
      table.push(`| ${s} | ${f} | ${(cpu.busy / secs).toFixed(0)} | ${r('prismSurfaces')} | ${r('upload')} | ${r('occludes')} | ${r('occluder')} | ${r('(gc)')} | ${long.length} | ${(long.reduce((a, b) => a + b, 0) / secs).toFixed(0)} | ${long.length ? Math.max(...long).toFixed(0) : 0} | ${v1 - v0} |`);
      console.error(table.at(-1));
      check(`${s} ${f}mm settles after drag`, await settle(), 'buildings and terrain complete');
    }

const coldTable = ['| scene | mm | load s | main busy ms | prism mesh build ms (tileMesh) | prismSurfaces ms | occludes ms | long tasks | long ms total | max long ms |', '|---|---|---|---|---|---|---|---|---|---|'];
if (mode === 'measure' || mode === 'all')
  for (const s of ['rotterdam', 'manhattan'])
    for (const f of [24, 200]) {
      // Cold: the viewfinder opened on a new document, until every tile has streamed in and drawn.
      const { secs, cpu, long } = await withLock(async () => {
        const w0 = performance.now();
        let tasks: number[] = [];
        const prof = await profiled(async () => {
          await go(url(s, f, 'l', 'day'));
          await settle();
          tasks = await tab.eval<number[]>('window.__long');
        }, `cold-${s}-${f}`);
        return { secs: (performance.now() - w0) / 1000, cpu: prof, long: tasks };
      });
      const r = (k: string) => (cpu.incl.get(k) ?? 0).toFixed(0);
      coldTable.push(`| ${s} | ${f} | ${secs.toFixed(1)} | ${cpu.busy.toFixed(0)} | ${r('tileMesh')} | ${r('prismSurfaces')} | ${r('occludes')} | ${long.length} | ${long.reduce((a, b) => a + b, 0).toFixed(0)} | ${long.length ? Math.max(...long).toFixed(0) : 0} |`);
      console.error(coldTable.at(-1));
    }

/** A fixed fan of directions and ranges through `behindBuilding`, plus the body and marker flags the overlay drew. */
const OCC = `(() => {
  const p = window.__scape.prism, c = p.cam, out = [];
  for (let i = 0; i < 181; i++) for (let j = 0; j < 61; j++) {
    const az = c.azimuthDeg - 45 + i * 0.5, alt = -2 + j * 0.5;
    out.push(p.behindBuilding(az, alt, Infinity) ? 1 : 0, p.behindBuilding(az, alt, 400) ? 1 : 0);
  }
  const o = window.__scape.overlay ?? { bodies: {}, markers: {} };
  const bodies = Object.fromEntries(Object.entries(o.bodies).map(([k, v]) => [k, v.hidden]));
  return { bits: out.join(''), bodies, markers: o.markers, buildings: p.buildings };
})()`;
if (mode === 'occ' || mode === 'all') {
  const have: Record<string, unknown> = ref !== '-' && existsSync(ref) ? JSON.parse(readFileSync(ref, 'utf8')) : {};
  const got: Record<string, unknown> = {};
  for (const s of Object.keys(SCENES))
    for (const time of ['day', 'night'] as const)
      for (const f of [24, 200]) {
        const name = `${s}-${time}-${f}`;
        await go(url(s, f, 'l', time));
        if (!(await settle())) {
          check(`occ ${name} settles`, false, 'never settled');
          continue;
        }
        const r = await tab.eval<{ bits: string; bodies: Record<string, boolean>; markers: Record<string, boolean>; buildings: number }>(OCC);
        got[name] = r;
        const hid = [...r.bits].filter((b) => b === '1').length;
        const was = have[name] as typeof r | undefined;
        if (!was) check(`occ ${name}`, hid > 0, `${hid} of ${r.bits.length} rays hidden, bodies ${JSON.stringify(r.bodies)} (no reference)`);
        else {
          let diff = 0;
          for (let k = 0; k < r.bits.length; k++) if (r.bits[k] !== was.bits[k]) diff++;
          const same = diff === 0 && JSON.stringify(r.bodies) === JSON.stringify(was.bodies) && JSON.stringify(r.markers) === JSON.stringify(was.markers);
          check(`occ ${name} matches reference`, same && r.bits.length === was.bits.length, `${diff} of ${r.bits.length} rays differ (${hid} hidden), bodies ${JSON.stringify(r.bodies)}`);
        }
      }
  writeFileSync(`${shots}/occ.json`, JSON.stringify(got));
}

if (mode === 'stills' || mode === 'all') {
  for (const f of FOCALS)
    for (const o of ['l', 'p'] as const)
      for (const time of ['day', 'night'] as const) {
        const name = `still-rotterdam-${f}-${o}-${time}`;
        await go(url('rotterdam', f, o, time));
        const ok = await settle();
        await tab.shot(`${shots}/${name}.png`);
        const n = await tab.eval<{ b: number; t: number; err: string | null }>('(() => { const p = window.__scape.prism; return { b: p.buildings, t: p.tiles, err: window.__scape.buildings.getState().error }; })()');
        check(`still ${name}`, ok && n.b > 0 && !n.err, `${n.b} buildings in ${n.t} tiles${n.err ? `, error ${n.err}` : ''}`);
      }
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await go(url('rotterdam', 24, 'p', 'day'));
  const ok = await settle();
  await tab.shot(`${shots}/phone-rotterdam.png`);
  const n = await tab.eval<{ b: number; sw: number; w: number }>('({ b: window.__scape.prism.buildings, sw: document.documentElement.scrollWidth, w: innerWidth })');
  check('phone 390x844', ok && n.b > 0 && n.sw <= n.w, `${n.b} buildings, scrollWidth ${n.sw} of ${n.w}`);
  await tab.viewport(1400, 900);
}

console.log(table.join('\n'));
console.log(`\n${coldTable.join('\n')}`);
console.log('\n| check | result | detail |\n|---|---|---|');
console.log(rows.join('\n'));
tab.close();
process.exit(failed ? 1 : 0);
