// Console smoke: every warning, error, uncaught exception and failed request the page and its workers log over the main flows, desktop and phone.
// Usage: bun scripts/smoke/console.ts <cdp> <dev-port> <out-dir>; writes <out-dir>/console-chromium.json and prints the deduplicated list.
/* oxlint-disable no-await-in-loop -- steps run one at a time */
import { mkdirSync } from 'node:fs';
import { Tab } from './cdp';
import { flows, report, PHOTO_JPEG, Viewports, type Driver, type Entry } from './console-flows';

const [cdp, port, out] = process.argv.slice(2);
const BASE = `http://localhost:${port}`;
mkdirSync(out, { recursive: true });

type Frame = { url: string; lineNumber: number };
type Remote = { type: string; value?: unknown; description?: string };
const where = (st?: { callFrames: Frame[] }) => {
  const f = st?.callFrames.find((c) => c.url && !c.url.includes('/@vite/client'));
  return f ? `${f.url}:${f.lineNumber + 1}` : '';
};
const show = (a: Remote) => (a.type === 'string' ? String(a.value) : (a.description ?? JSON.stringify(a.value)));

const tab = await Tab.open(Number(cdp), BASE);
const log: (Entry & { step: string })[] = [];
let step = '';
tab.listeners.push((method, p, session) => {
  const src = session ? 'worker' : 'page';
  if (method === 'Runtime.consoleAPICalled' && ['warning', 'error', 'assert'].includes(String(p.type))) {
    const args = (p.args as Remote[]).map(show).join(' ');
    log.push({ kind: `console (${src})`, level: String(p.type), text: args, at: where(p.stackTrace as { callFrames: Frame[] }), step });
  }
  if (method === 'Runtime.exceptionThrown') {
    const d = p.exceptionDetails as { text: string; exception?: Remote; url?: string; lineNumber?: number; stackTrace?: { callFrames: Frame[] } };
    log.push({ kind: `exception (${src})`, level: 'error', text: d.exception?.description?.split('\n')[0] ?? d.text, at: where(d.stackTrace) || (d.url ? `${d.url}:${(d.lineNumber ?? 0) + 1}` : ''), step });
  }
  if (method === 'Log.entryAdded') {
    const e = p.entry as { source: string; level: string; text: string; url?: string; lineNumber?: number };
    // Worker console calls also arrive as Runtime.consoleAPICalled.
    if ((e.level === 'warning' || e.level === 'error') && e.source !== 'worker') log.push({ kind: `browser ${e.source} (${src})`, level: e.level, text: e.text, at: e.url ? `${e.url}${e.lineNumber != null ? `:${e.lineNumber + 1}` : ''}` : '', step });
  }
});
tab.workerSetup.push(async (s) => {
  await tab.send('Runtime.enable', {}, s).catch(() => {});
  await tab.send('Log.enable', {}, s).catch(() => {});
});
await tab.send('Log.enable');
await tab.send('DOM.enable');

const pointer = async (type: string, x: number, y: number, buttons = 0) =>
  tab.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: 1 });
const driver: Driver = {
  eval: (e, ms) => tab.eval(e, ms),
  navigate: (u) => tab.navigate(u),
  viewport: (w, h) => tab.viewport(w, h),
  tap: async (x, y) => {
    await pointer('mouseMoved', x, y);
    await pointer('mousePressed', x, y, 1);
    await pointer('mouseReleased', x, y);
    await Bun.sleep(250);
  },
  wheel: async (x, y, dy) => {
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
    await Bun.sleep(150);
  },
  drag: async (x0, y0, x1, y1) => {
    await pointer('mouseMoved', x0, y0);
    await pointer('mousePressed', x0, y0, 1);
    for (let i = 1; i <= 10; i++) {
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / 10, y: y0 + ((y1 - y0) * i) / 10, button: 'left', buttons: 1 });
      await Bun.sleep(16);
    }
    await pointer('mouseReleased', x1, y1);
  },
  setFiles: async (selector, files) => {
    const r = (await tab.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` })) as { result: { objectId?: string } };
    if (!r.result.objectId) throw new Error(`no ${selector}`);
    await tab.send('DOM.setFileInputFiles', { files, objectId: r.result.objectId });
  }
};

await tab.fresh(BASE);
await tab.navigate(`${BASE}/`);
const photo = `${out}/photo.jpg`;
await Bun.write(photo, Buffer.from(await tab.eval<string>(PHOTO_JPEG), 'base64'));
const files = { glb: `${out}/spire-tower.glb`, photo };

const ran: Record<string, Record<string, boolean>> = {};
for (const [name, vp] of Object.entries(Viewports)) {
  await tab.viewport(vp.w, vp.h);
  ran[name] = await flows(driver, BASE, files, (s) => {
    step = `${name}: ${s}`;
    console.error(step);
  });
  await tab.shot(`${out}/chromium-${name}.png`);
}
tab.close();

const rows = report(log, ran);
await Bun.write(`${out}/console-chromium.json`, JSON.stringify({ log, rows }, null, 1));
