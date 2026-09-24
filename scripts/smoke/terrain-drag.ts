// Terrain drag smoke: CPU per thread, mesh rebuilds and frame pacing over a scripted aim drag, holes mid-drag, and settled pictures against a baseline.
/* oxlint-disable no-await-in-loop -- smoke steps run one after another */
// Usage: bun scripts/smoke/terrain-drag.ts <cdp> <dev-port> <shot-dir> [baseline-dir|-] [gpu-lock-dir|-] [quick|drag|stills]
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { Tab } from './cdp';

const [cdp = '9408', port = '5408', shots = '/tmp/terrain-drag', baseline = '-', lock = '-', mode = ''] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
const QUICK = mode === 'quick';
const DRAG = mode !== 'stills';
const STILLS = mode !== 'drag';
mkdirSync(shots, { recursive: true });

const Scene = { Alps: 'alps', Flat: 'flat' } as const;
type Scene = (typeof Scene)[keyof typeof Scene];
const SCENES: Record<Scene, { camera: string; target: string; day: string; low: string; night: string }> = {
  // Zermatt facing the Matterhorn.
  alps: { camera: '46.0207,7.7491', target: '45.9766,7.6586', day: '2026-10-18T09:00Z', low: '2026-10-13T16:30Z', night: '2026-10-25T21:00Z' },
  // Rotterdam, Erasmusbrug towards the Maastoren: flat control.
  flat: { camera: '51.9050,4.4830', target: '51.9153,4.4890', day: '2026-10-18T11:00Z', low: '2026-10-13T16:10Z', night: '2026-10-25T21:00Z' }
};
const FOCALS = QUICK ? [24, 2400] : [24, 200, 600, 2400];
const DRAG_MS = 5000;

const rows: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  rows.push(`| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${detail} |`);
  if (!ok) failed++;
  console.error(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const tab = await Tab.open(Number(cdp), BASE);
await tab.viewport(1400, 900);

/** Browser-level CDP for per-process CPU time. */
const browserWs = await new Promise<WebSocket>((resolve, reject) => {
  void fetch(`http://localhost:${cdp}/json/version`)
    .then((r) => r.json() as Promise<{ webSocketDebuggerUrl: string }>)
    .then(({ webSocketDebuggerUrl }) => {
      const ws = new WebSocket(webSocketDebuggerUrl);
      ws.addEventListener('open', () => resolve(ws));
      ws.addEventListener('error', () => reject(new Error('no browser ws')));
    });
});
let bseq = 0;
const processCpu = () =>
  new Promise<{ type: string; id: number; cpuTime: number }[]>((resolve) => {
    const id = ++bseq;
    const on = (e: MessageEvent) => {
      const m = JSON.parse(String(e.data)) as { id?: number; result?: { processInfo: { type: string; id: number; cpuTime: number }[] } };
      if (m.id !== id) return;
      browserWs.removeEventListener('message', on);
      resolve(m.result?.processInfo ?? []);
    };
    browserWs.addEventListener('message', on);
    browserWs.send(JSON.stringify({ id, method: 'SystemInfo.getProcessInfo' }));
  });

// Page-side helpers: mesh request counters on the terrain worker, a frame recorder, settle wait and pixel diff.
const HELPERS = `(() => {
  if (window.__td) return true;
  const S = window.__scape;
  const td = { meshReq: 0, meshRes: 0, viewReq: 0, blocks: 0, reused: 0, cacheMB: 0, rec: null };
  const post = Worker.prototype.postMessage;
  const hooked = new WeakSet();
  Worker.prototype.postMessage = function (msg, ...rest) {
    if (msg && msg.kind === 'Mesh' && 'view' in msg) {
      td.meshReq++;
      if (!hooked.has(this)) {
        hooked.add(this);
        this.addEventListener('message', (e) => {
          const r = e.data?.kind === 'Mesh' ? e.data.result : null;
          if (!r) return;
          td.meshRes++;
          td.blocks += r.mesh.blockBox.length / 6;
          td.reused += r.reused ?? 0;
          td.cacheMB = (r.cacheBytes ?? 0) / 2 ** 20;
        });
      }
    }
    if (msg && msg.kind === 'View' && 'azSpanDeg' in msg) td.viewReq++;
    return post.call(this, msg, ...rest);
  };
  td.settled = () => {
    const t = S.terrain.getState();
    const p = S.prism;
    return !t.busy.Mesh && !t.busy.View && t.mesh.length > 0 && t.mesh.length === t.mesh[0].levels && !!p?.terrain && p.terrain.levels === t.mesh.length && !S.buildings.getState().busy;
  };
  td.start = () => {
    const r = { dt: [], levels: [], gpu: [], draws: 0, holes: 0, last: performance.now(), prism: S.prism, stop: false };
    td.rec = r;
    const loop = (now) => {
      if (r.stop) return;
      r.dt.push(now - r.last);
      r.last = now;
      if (S.prism !== r.prism) {
        r.prism = S.prism;
        r.draws++;
        const lv = S.prism?.terrain?.levels ?? 0;
        r.levels.push(lv);
        if (lv === 0) r.holes++;
        if (S.prism?.gpuMs >= 0) r.gpu.push(S.prism.gpuMs);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return true;
  };
  const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : -1; };
  td.stop = () => {
    const r = td.rec;
    r.stop = true;
    return { rafP50: pct(r.dt, 0.5), rafP95: pct(r.dt, 0.95), frames: r.dt.length, draws: r.draws, holes: r.holes, minLevels: r.levels.length ? Math.min(...r.levels) : -1, gpuP50: pct(r.gpu, 0.5), gpuP95: pct(r.gpu, 0.95) };
  };
  td.frame = () => {
    const r = document.querySelector('canvas.vf').getBoundingClientRect(), f = S.prism.cam.frame;
    return { x: r.left + f.x, y: r.top + f.y, w: f.w, h: f.h };
  };
  const decode = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => { const c = new OffscreenCanvas(i.width, i.height).getContext('2d'); c.drawImage(i, 0, 0); res(c.getImageData(0, 0, i.width, i.height)); }; i.src = 'data:image/png;base64,' + b64; });
  td.diff = async (a, b) => {
    const [x, y] = await Promise.all([decode(a), decode(b)]);
    if (x.width !== y.width || x.height !== y.height) return { size: true, px: -1, max: 255 };
    let px = 0, max = 0;
    for (let k = 0; k < x.data.length; k += 4) {
      const d = Math.max(Math.abs(x.data[k] - y.data[k]), Math.abs(x.data[k + 1] - y.data[k + 1]), Math.abs(x.data[k + 2] - y.data[k + 2]));
      if (d > 0) px++;
      if (d > max) max = d;
    }
    return { size: false, px, max, share: px / (x.width * x.height) };
  };
  /** Share of the frame's pixels that show ground: not the sky gradient's blue-dominant colours. */
  td.ground = async (b64, f) => {
    const img = await decode(b64);
    const s = img.width / window.innerWidth;
    let g = 0, n = 0;
    for (let y = Math.ceil(f.y * s); y < (f.y + f.h) * s; y += 4)
      for (let x = Math.ceil(f.x * s); x < (f.x + f.w) * s; x += 4) {
        const k = (y * img.width + x) * 4;
        n++;
        if (!(img.data[k + 2] > img.data[k] + 12 && img.data[k + 2] > img.data[k + 1])) g++;
      }
    return g / n;
  };
  window.__td = td;
  return true;
})()`;

const go = async (url: string) => {
  await tab.navigate(url);
  await tab.until('!!(window.__scape && document.querySelector("canvas.vf"))', 30_000, 250);
  await tab.eval(HELPERS);
};
const settle = async () => {
  const ok = await tab.until('window.__td.settled()', 90_000, 250);
  await Bun.sleep(1000);
  return !!ok && (await tab.eval<boolean>('window.__td.settled()'));
};

type Cpu = { thread: string; ms: number; top: string };
/** Sampling profiles of the page and every worker over `fn`: busy ms per thread and its hottest functions. */
async function profiled(fn: () => Promise<void>): Promise<Cpu[]> {
  const sessions: [string | undefined, string][] = [[undefined, 'main'], ...tab.workerSessions().map(([s, u]): [string, string] => [s, u.split('/').pop()?.split('?')[0] ?? u])];
  for (const [s] of sessions) {
    await tab.send('Profiler.enable', {}, s);
    await tab.send('Profiler.setSamplingInterval', { interval: 500 }, s);
    await tab.send('Profiler.start', {}, s);
  }
  await fn();
  const out: Cpu[] = [];
  for (const [s, name] of sessions) {
    const { profile } = (await tab.send('Profiler.stop', {}, s)) as { profile: { nodes: { id: number; callFrame: { functionName: string } }[]; samples: number[]; timeDeltas: number[] } };
    const fnOf = new Map(profile.nodes.map((n) => [n.id, n.callFrame.functionName || '(anon)']));
    const self = new Map<string, number>();
    let busy = 0;
    profile.samples.forEach((id, i) => {
      const f = fnOf.get(id) ?? '?';
      const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
      if (f === '(idle)') return;
      busy += dt;
      self.set(f, (self.get(f) ?? 0) + dt);
    });
    const top = [...self.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([f, ms]) => `${f} ${ms.toFixed(0)}`)
      .join(', ');
    out.push({ thread: name, ms: busy, top });
  }
  return out;
}

/** A 5 s pointer drag across the frame: a pan with a slow tilt wave, held 300 ms each second as a hand does. */
async function drag(f: { x: number; y: number; w: number; h: number }, midShots: string[], holeShot: string) {
  const x0 = f.x + f.w * 0.8;
  const y0 = f.y + f.h / 2;
  const at = (t: number) => {
    const moving = Math.floor(t / 1000) * 700 + Math.min(t % 1000, 700);
    return { x: x0 - (moving / (DRAG_MS * 0.7)) * f.w * 0.6, y: y0 + Math.sin((moving / 1750) * 2 * Math.PI) * f.h * 0.05, held: t % 1000 >= 700 };
  };
  const mouse = (type: string, x: number, y: number) => tab.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
  await mouse('mousePressed', x0, y0);
  const t0 = performance.now();
  let shot = 0;
  let holeShot0 = false;
  for (;;) {
    const t = performance.now() - t0;
    if (t > DRAG_MS) break;
    const p = at(t);
    if (!p.held) await mouse('mouseMoved', p.x, p.y);
    else if (shot < midShots.length && Math.floor(t / 1000) === shot + 1) await tab.shot(midShots[shot++]);
    if (!holeShot0 && (await tab.eval<number>('window.__scape.prism?.terrain?.levels ?? 0')) === 0) {
      holeShot0 = true;
      await tab.shot(holeShot);
    }
    await Bun.sleep(8);
  }
  const end = at(DRAG_MS);
  await mouse('mouseReleased', end.x, end.y);
}

const takeLock = async () => {
  if (lock === '-') return () => {};
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      console.error('waiting for the GPU timing lock');
      await Bun.sleep(30_000);
    }
  }
  return () => rmdirSync(lock);
};

const url = (s: Scene, f: number, orient: 'l' | 'p', time: string) => `${BASE}/viewfinder?camera=${SCENES[s].camera}&target=${SCENES[s].target}&t=${SCENES[s][time as 'day']}&f=${f}${orient === 'p' ? '&o=p' : ''}`;
const b64Of = async (path: string) => Buffer.from(await Bun.file(path).arrayBuffer()).toString('base64');
const compare = async (name: string, path: string) => {
  const ref = `${baseline}/${name}`;
  if (baseline === '-' || !existsSync(ref)) return;
  const d = await tab.eval<{ size: boolean; px: number; max: number; share: number }>(`window.__td.diff(${JSON.stringify(await b64Of(ref))}, ${JSON.stringify(await b64Of(path))})`);
  check(`settled ${name} vs baseline`, !d.size && d.px === 0, d.size ? 'size differs' : `${d.px} px differ (${(d.share * 100).toFixed(3)}%), max Δ ${d.max}`);
};

const table: string[] = ['| scene | mm | renderer CPU% | GPU-proc CPU% | terrain worker ms/s | main ms/s | mesh req / res | view req | rAF p50/p95 ms | draws | hole frames | GPU ms p50/p95 | min ground share mid-drag | blocks reused / sent | block cache MB |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
const release = await takeLock();
try {
  for (const s of !DRAG ? [] : QUICK ? [Scene.Alps] : [Scene.Alps, Scene.Flat]) {
    for (const f of FOCALS) {
      await go(url(s, f, 'l', 'day'));
      if (!(await settle())) {
        check(`${s} ${f}mm settles`, false, 'terrain never settled');
        continue;
      }
      const frame = await tab.eval<{ x: number; y: number; w: number; h: number }>('window.__td.frame()');
      const c0 = await tab.eval<{ meshReq: number; meshRes: number; viewReq: number; blocks: number; reused: number; cacheMB: number }>('(({ meshReq, meshRes, viewReq, blocks, reused, cacheMB }) => ({ meshReq, meshRes, viewReq, blocks, reused, cacheMB }))(window.__td)');
      const mid = [1, 2, 3].map((i) => `${shots}/mid-${s}-${f}-${i}.png`);
      const p0 = await processCpu();
      const w0 = performance.now();
      let rec = { rafP50: 0, rafP95: 0, frames: 0, draws: 0, holes: 0, minLevels: 0, gpuP50: 0, gpuP95: 0 };
      const cpu = await profiled(async () => {
        await tab.eval('window.__td.start()');
        await drag(frame, mid, `${shots}/hole-${s}-${f}.png`);
        rec = await tab.eval('window.__td.stop()');
      });
      const wall = performance.now() - w0;
      const p1 = await processCpu();
      const delta = (type: string) => Math.max(0, ...p1.filter((p) => p.type === type).map((p) => p.cpuTime - (p0.find((q) => q.id === p.id)?.cpuTime ?? 0)));
      const c1 = await tab.eval<{ meshReq: number; meshRes: number; viewReq: number; blocks: number; reused: number; cacheMB: number }>('(({ meshReq, meshRes, viewReq, blocks, reused, cacheMB }) => ({ meshReq, meshRes, viewReq, blocks, reused, cacheMB }))(window.__td)');
      const secs = wall / 1000;
      const terrainMs = cpu.filter((c) => c.thread.startsWith('terrain')).reduce((a, c) => a + c.ms, 0);
      const mainMs = cpu.find((c) => c.thread === 'main')?.ms ?? 0;
      const shares: number[] = [];
      for (const m of mid) if (existsSync(m)) shares.push(await tab.eval<number>(`window.__td.ground(${JSON.stringify(await b64Of(m))}, ${JSON.stringify(frame)})`));
      table.push(`| ${s} | ${f} | ${((delta('renderer') / secs) * 100).toFixed(0)} | ${((delta('GPU') / secs) * 100).toFixed(0)} | ${(terrainMs / secs).toFixed(0)} | ${(mainMs / secs).toFixed(0)} | ${c1.meshReq - c0.meshReq} / ${c1.meshRes - c0.meshRes} | ${c1.viewReq - c0.viewReq} | ${rec.rafP50.toFixed(1)} / ${rec.rafP95.toFixed(1)} | ${rec.draws} | ${rec.holes} | ${rec.gpuP50.toFixed(1)} / ${rec.gpuP95.toFixed(1)} | ${shares.length ? Math.min(...shares).toFixed(2) : '-'} | ${c1.reused - c0.reused} / ${c1.blocks - c0.blocks} | ${c1.cacheMB.toFixed(1)} |`);
      console.error(table.at(-1));
      for (const c of cpu) console.error(`  ${c.thread}: ${(c.ms / secs).toFixed(0)} ms/s — ${c.top}`);
      check(`${s} ${f}mm no hole frames mid-drag`, rec.holes === 0, `${rec.holes} of ${rec.draws} draws without terrain`);
      await settle();
      // Wall-clock pointer timing ends the drag a hair off; snap to a grid so both runs frame the same picture.
      const a1 = await tab.eval<{ az: number; el: number }>('(({ azimuthDeg: az, elevationDeg: el }) => ({ az, el }))(window.__scape.composition.getState())');
      const step = (2 * Math.atan(12 / f) * 180) / Math.PI / 8;
      const [az, el] = [a1.az, a1.el].map((v) => Math.round(v / step) * step);
      await tab.eval(`window.__scape.composition.getState().aim(${az}, ${el})`);
      console.error(`  drag end ${a1.az.toFixed(3)}/${a1.el.toFixed(3)} snapped ${az.toFixed(3)}/${el.toFixed(3)}`);
      const settledOk = await settle();
      const name = `drag-${s}-${f}.png`;
      await tab.shot(`${shots}/${name}`);
      check(`${s} ${f}mm settles after drag`, settledOk, settledOk ? 'mesh complete' : 'still busy');
      await compare(name, `${shots}/${name}`);
    }
  }
} finally {
  release();
}

// Settled pictures: every focal, orientation and light, against the baseline when one is given.
for (const f of STILLS ? FOCALS : [])
  for (const o of ['l', 'p'] as const)
    for (const time of QUICK ? ['day'] : ['day', 'low', 'night']) {
      const name = `still-alps-${f}-${o}-${time}.png`;
      let ok = false;
      // One retry: a heavy first frame can stall the tab past the eval timeout.
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          await go(url(Scene.Alps, f, o, time));
          ok = await settle();
        } catch (e) {
          console.error(`${name}: ${String(e)}`);
        }
      }
      await tab.shot(`${shots}/${name}`);
      if (!ok) check(`still ${name} settles`, false, 'terrain never settled');
      await compare(name, `${shots}/${name}`);
    }

console.log(table.join('\n'));
console.log('\n| check | result | detail |\n|---|---|---|');
console.log(rows.join('\n'));
browserWs.close();
tab.close();
process.exit(failed ? 1 : 0);
