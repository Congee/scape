// Console smoke in Firefox: console-flows.ts over WebDriver BiDi, collecting log.entryAdded warnings and errors (Firefox logs no failed requests there).
// Usage: bun scripts/smoke/console-firefox.ts <bidi-port> <dev-port> <out-dir>; writes <out-dir>/console-firefox.json and prints the deduplicated list.
/* oxlint-disable no-await-in-loop -- steps run one at a time */
import { mkdirSync } from 'node:fs';
import { BidiTab } from './bidi';
import { flows, report, PHOTO_JPEG, Viewports, type Driver, type Entry } from './console-flows';

const [bidi, port, out] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(out, { recursive: true });

// Firefox holds one session; another smoke may own it, so wait for it rather than take it.
let tab: BidiTab | null = null;
for (let i = 0; !tab; i++) {
  tab = await BidiTab.open(Number(bidi)).catch(async (e: Error) => {
    if (!/Maximum number of active sessions/i.test(e.message) || i >= 60) throw e;
    console.error(`Firefox busy, retry ${i + 1} in 60 s`);
    await Bun.sleep(60_000);
    return null;
  });
}
const t = tab;

type Frame = { url: string; lineNumber: number };
const where = (st?: { callFrames: Frame[] }) => {
  const f = st?.callFrames.find((c) => c.url && !c.url.includes('/@vite/client'));
  return f ? `${f.url}:${f.lineNumber + 1}` : '';
};
const log: (Entry & { step: string })[] = [];
let step = '';
t.listeners.push((method, p) => {
  if (method === 'log.entryAdded' && (p.level === 'warn' || p.level === 'error')) {
    const realm = (p.source as { context?: string } | undefined)?.context ? 'page' : 'worker';
    log.push({ kind: `${String(p.type)} (${realm})`, level: String(p.level), text: String(p.text), at: where(p.stackTrace as { callFrames: Frame[] }), step });
  }
});

const act = (actions: unknown[]) => t.send('input.performActions', { context: t.context, actions });
const pointer = (steps: unknown[]) => act([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: steps }]);
const move = (x: number, y: number, duration = 0) => ({ type: 'pointerMove', x: Math.round(x), y: Math.round(y), duration });
const driver: Driver = {
  eval: (e, ms) => t.eval(e, ms),
  // A load still redirecting when the next navigate starts aborts it; go again.
  navigate: async (u) => {
    for (let i = 0; ; i++)
      try {
        return await t.navigate(u);
      } catch (e) {
        if (i >= 3 || !/NS_BINDING_ABORTED/.test((e as Error).message)) throw e;
        await Bun.sleep(1000);
      }
  },
  viewport: async (w, h) => void (await t.send('browsingContext.setViewport', { context: t.context, viewport: { width: w, height: h }, devicePixelRatio: null })),
  tap: async (x, y) => {
    await pointer([move(x, y), { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }]);
    await Bun.sleep(250);
  },
  wheel: async (x, y, dy) => {
    await act([{ type: 'wheel', id: 'wh', actions: [{ type: 'scroll', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY: dy, duration: 0 }] }]);
    await Bun.sleep(150);
  },
  drag: async (x0, y0, x1, y1) => void (await pointer([move(x0, y0), { type: 'pointerDown', button: 0 }, move(x1, y1, 300), { type: 'pointerUp', button: 0 }])),
  setFiles: async (selector, files) => {
    const r = (await t.send('script.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
      target: { context: t.context },
      awaitPromise: false,
      resultOwnership: 'root'
    })) as { result?: { sharedId?: string } };
    if (!r.result?.sharedId) throw new Error(`no ${selector}`);
    await t.send('input.setFiles', { context: t.context, element: { sharedId: r.result.sharedId }, files });
  }
};

const KEEP = `Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('scape.')).map((k) => [k, localStorage.getItem(k)]))`;
const ran: Record<string, Record<string, boolean>> = {};
let saved: Record<string, string> | null = null;
try {
  await t.send('session.subscribe', { events: ['log.entryAdded'] });
  await t.navigate(`${BASE}/`);
  // This Firefox profile is shared with other smokes: put its settings back afterwards.
  saved = await t.eval<Record<string, string>>(KEEP);
  const photo = `${out}/photo.jpg`;
  await Bun.write(photo, Buffer.from(await t.eval<string>(PHOTO_JPEG), 'base64'));
  const files = { glb: `${out}/spire-tower.glb`, photo };
for (const [name, vp] of Object.entries(Viewports)) {
    await driver.viewport(vp.w, vp.h);
    ran[name] = await flows(driver, BASE, files, (s) => {
      step = `${name}: ${s}`;
      console.error(step);
    });
    await t.shot(`${out}/firefox-${name}.png`);
  }
} finally {
  if (saved) {
    await t.navigate(`${BASE}/robots.txt`).catch(() => {});
    await t.eval(`(() => { const s = ${JSON.stringify(saved)}; for (const k of Object.keys(localStorage)) if (k.startsWith('scape.') && !(k in s)) localStorage.removeItem(k); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); return 1; })()`).catch((e: Error) => console.error(`restore: ${e.message}`));
  }
  await t.send('browsingContext.setViewport', { context: t.context, viewport: null, devicePixelRatio: null }).catch(() => {});
  await t.navigate('about:blank').catch(() => {});
  await t.close();
}

const rows = report(log, ran);
await Bun.write(`${out}/console-firefox.json`, JSON.stringify({ log, rows }, null, 1));
