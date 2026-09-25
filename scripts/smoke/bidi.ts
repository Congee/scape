// A minimal WebDriver BiDi client for Firefox's remote agent: one session, one tab, the calls the smokes need.
/* oxlint-disable no-await-in-loop -- BiDi steps are sequential */

import { unlink } from 'node:fs/promises';

type Msg = { id?: number; type?: string; method?: string; result?: Record<string, unknown>; error?: string; message?: string };
type Remote = { type: string; value?: unknown };

export class BidiTab {
  private seq = 0;
  private waiters = new Map<number, (m: Msg) => void>();

  context = '';

  private constructor(
    private ws: WebSocket,
    private sessionFile: string
  ) {}

  private static async connect(url: string, sessionFile: string): Promise<BidiTab> {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error(`cannot connect BiDi at ${url}`)));
    });
    const tab = new BidiTab(ws, sessionFile);
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as Msg;
      if (m.id != null) tab.waiters.get(m.id)?.(m);
    });
    return tab;
  }

  /**
   * A session on the browser at `port`, driving its first tab; the window is never raised. Firefox keeps a session after its
   * socket closes and allows only one, so the id goes to `sessionFile`, and webSocketUrl lets a later run rejoin one a crash left behind.
   */
  static async open(port: number, sessionFile = `${process.env.TMPDIR ?? '/tmp'}/bidi-${port}.session`): Promise<BidiTab> {
    let tab = await BidiTab.connect(`ws://127.0.0.1:${port}/session`, sessionFile);
    try {
      const { sessionId } = (await tab.send('session.new', { capabilities: { alwaysMatch: { webSocketUrl: true } } })) as { sessionId: string };
      await Bun.write(sessionFile, sessionId);
    } catch (e) {
      const id = await Bun.file(sessionFile).text().catch(() => '');
      if (!/Maximum number of active sessions|already started/i.test(String(e)) || !id) throw e;
      tab.ws.close();
      tab = await BidiTab.connect(`ws://127.0.0.1:${port}/session/${id.trim()}`, sessionFile);
    }
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => void tab.close().finally(() => process.exit(130)));
    for (const ev of ['unhandledRejection', 'uncaughtException'] as const)
      process.once(ev, (e) => {
        console.error(e);
        void tab.close().finally(() => process.exit(1));
      });
    try {
      const tree = (await tab.send('browsingContext.getTree', { maxDepth: 0 })) as { contexts: { context: string }[] };
      tab.context = tree.contexts[0].context;
    } catch (e) {
      await tab.close();
      throw e;
    }
    return tab;
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      this.waiters.set(id, (m) => {
        clearTimeout(t);
        this.waiters.delete(id);
        if (m.type === 'error') reject(new Error(`${method}: ${m.error} ${m.message}`));
        else resolve(m.result ?? {});
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url: string) {
    await this.send('browsingContext.navigate', { context: this.context, url, wait: 'complete' }, 120_000);
  }

  /** Value of an expression (awaited if a promise), round-tripped through JSON. */
  async eval<T = unknown>(expr: string, timeoutMs = 60_000): Promise<T> {
    const r = (await this.send(
      'script.evaluate',
      { expression: `(async () => JSON.stringify(await (${expr})))()`, target: { context: this.context }, awaitPromise: true },
      timeoutMs
    )) as { type: string; result?: Remote; exceptionDetails?: { text: string } };
    if (r.type === 'exception') throw new Error(`eval: ${r.exceptionDetails?.text}`);
    const v = r.result?.value;
    return (typeof v === 'string' ? JSON.parse(v) : v) as T;
  }

  /** Polls until the expression is truthy. */
  async until(expr: string, timeoutMs = 30_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.eval<boolean>(`!!(${expr})`).catch(() => false)) return;
      await Bun.sleep(200);
    }
    throw new Error(`timed out waiting for ${expr}`);
  }

  /** Viewport PNG. */
  async shot(path: string) {
    const r = (await this.send('browsingContext.captureScreenshot', { context: this.context })) as { data: string };
    await Bun.write(path, Buffer.from(r.data, 'base64'));
  }

  /** Quits the browser the way its menu would, so shutdown work such as writing a startup profile runs. */
  async quit() {
    await this.send('browser.close', {}, 30_000).catch(() => {});
    await unlink(this.sessionFile).catch(() => {});
    this.ws.close();
  }

  async close() {
    await this.send('session.end', {}, 5000).catch(() => {});
    await unlink(this.sessionFile).catch(() => {});
    this.ws.close();
  }
}
