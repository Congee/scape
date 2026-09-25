// A minimal WebDriver BiDi client for Firefox's remote agent: one session, one tab, the calls the smokes need.
/* oxlint-disable no-await-in-loop -- BiDi steps are sequential */

import { unlink } from 'node:fs/promises';

type Msg = { id?: number | null; type?: string; method?: string; result?: Record<string, unknown>; error?: string; message?: string };
type Remote = { type: string; value?: unknown };
type Listener = (e: { data?: unknown }) => void;

/** The WebSocket surface the client uses. */
export type Socket = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', fn: Listener): void;
};

/** Everything with a side effect, so tests can swap in fakes. */
export type BidiDeps = {
  socket: (url: string) => Socket;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
  sleep: (ms: number) => Promise<unknown>;
  now: () => number;
  /** Rejects when the file is missing. */
  read: (path: string) => Promise<string>;
  write: (path: string, data: string | Uint8Array) => Promise<unknown>;
  unlink: (path: string) => Promise<unknown>;
  proc: { on(ev: string, fn: (e?: unknown) => void): unknown; off(ev: string, fn: (e?: unknown) => void): unknown; exit(code: number): void };
};

const defaults: BidiDeps = {
  socket: (url) => new WebSocket(url) as unknown as Socket,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  sleep: (ms) => Bun.sleep(ms),
  now: () => Date.now(),
  read: (p) => Bun.file(p).text(),
  write: (p, d) => Bun.write(p, d),
  unlink: (p) => unlink(p),
  proc: process
};

const OPEN = 1;
/** Exit codes a shell reports for these signals. */
export const Signals = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;

export class BidiTab {
  private seq = 0;
  private waiters = new Map<number, { done: (m: Msg) => void; fail: (e: Error) => void }>();
  private lost: Error | null = null;
  private shut: Promise<void>;
  private closing: Promise<void> | null = null;
  private unhook = () => {};

  context = '';

  private constructor(
    private ws: Socket,
    private sessionFile: string,
    private deps: BidiDeps,
    url: string
  ) {
    this.shut = new Promise((resolve) => ws.addEventListener('close', () => resolve()));
    ws.addEventListener('message', (e) => this.receive(String(e.data)));
    ws.addEventListener('close', () => this.drop(new Error(`BiDi socket ${url} closed`)));
    ws.addEventListener('error', () => this.drop(new Error(`BiDi socket ${url} failed`)));
  }

  private static connect(url: string, sessionFile: string, deps: BidiDeps, timeoutMs = 10_000): Promise<BidiTab> {
    return new Promise((resolve, reject) => {
      const ws = deps.socket(url);
      let settled = false;
      const fail = (why: string) => {
        if (settled) return;
        settled = true;
        deps.clearTimeout(t);
        ws.close();
        reject(new Error(`cannot connect BiDi at ${url}: ${why}`));
      };
      const t = deps.setTimeout(() => fail(`no handshake in ${timeoutMs} ms`), timeoutMs);
      ws.addEventListener('error', () => fail('connection failed'));
      ws.addEventListener('close', () => fail('connection closed'));
      ws.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        deps.clearTimeout(t);
        resolve(new BidiTab(ws, sessionFile, deps, url));
      });
    });
  }

  /**
   * A session on the browser at `port`, driving its first tab; the window is never raised. Firefox keeps a session after its
   * socket closes and allows only one, so the id goes to `sessionFile`, and webSocketUrl lets a later run rejoin one a crash left behind.
   */
  static async open(port: number, sessionFile = `${process.env.TMPDIR ?? '/tmp'}/bidi-${port}.session`, deps: BidiDeps = defaults): Promise<BidiTab> {
    let tab = await BidiTab.connect(`ws://127.0.0.1:${port}/session`, sessionFile, deps).catch((e: Error) => {
      throw new Error(`${e.message} (no Firefox remote agent on port ${port}: start it with --remote-debugging-port ${port}, or free the port)`, { cause: e });
    });
    let id = '';
    try {
      const { sessionId } = (await tab.send('session.new', { capabilities: { alwaysMatch: { webSocketUrl: true } } })) as { sessionId: string };
      await deps.write(sessionFile, sessionId);
    } catch (e) {
      tab.ws.close();
      if (!/Maximum number of active sessions|already started/i.test(String(e))) throw e;
      id = (await deps.read(sessionFile).catch(() => '')).trim();
      if (!id) throw new Error(`${(e as Error).message} (another client holds the session on port ${port} and ${sessionFile} has no id to rejoin; restart that Firefox)`, { cause: e });
    }
    if (id)
      tab = await BidiTab.connect(`ws://127.0.0.1:${port}/session/${id}`, sessionFile, deps).catch((err: Error) => {
        throw new Error(`${err.message} (session ${id} from ${sessionFile} is gone or held by another client; restart that Firefox)`, { cause: err });
      });
    tab.hook();
    try {
      const tree = (await tab.send('browsingContext.getTree', { maxDepth: 0 })) as { contexts: { context: string }[] };
      tab.context = tree.contexts[0].context;
    } catch (e) {
      await tab.close();
      throw e;
    }
    return tab;
  }

  /** Ends the session on SIGHUP/SIGINT/SIGTERM or a crash; a second signal during cleanup kills as usual. */
  private hook() {
    const { proc } = this.deps;
    const bye = (code: number) => void this.close().finally(() => proc.exit(code));
    const handlers: [string, (e?: unknown) => void][] = Object.entries(Signals).map(([sig, code]) => [sig, () => bye(code)]);
    const crash = (e?: unknown) => {
      console.error(e);
      bye(1);
    };
    handlers.push(['unhandledRejection', crash], ['uncaughtException', crash]);
    for (const [ev, fn] of handlers) proc.on(ev, fn);
    this.unhook = () => {
      for (const [ev, fn] of handlers) proc.off(ev, fn);
      this.unhook = () => {};
    };
  }

  private receive(data: string) {
    let m: Msg;
    try {
      m = JSON.parse(data) as Msg;
    } catch {
      console.error(`BiDi: unparseable message ${data.slice(0, 200)}`);
      return;
    }
    if (m.id != null) this.waiters.get(m.id)?.done(m);
    else if (m.type === 'error') console.error(`BiDi: ${m.error} ${m.message}`);
  }

  /** Rejects every pending command once the socket is gone. */
  private drop(e: Error) {
    this.lost ??= e;
    for (const w of this.waiters.values()) w.fail(this.lost);
    this.waiters.clear();
  }

  private get up() {
    return !this.lost && this.ws.readyState === OPEN;
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    if (!this.up) return Promise.reject(new Error(`${method}: ${this.lost?.message ?? 'BiDi socket not open'}`));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const settle = () => {
        this.deps.clearTimeout(t);
        this.waiters.delete(id);
      };
      const t = this.deps.setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiters.set(id, {
        done: (m) => {
          settle();
          if (m.type === 'error') reject(new Error(`${method}: ${m.error} ${m.message}`));
          else resolve(m.result ?? {});
        },
        fail: (e) => {
          settle();
          reject(new Error(`${method}: ${e.message}`));
        }
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        settle();
        reject(e);
      }
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
    const end = this.deps.now() + timeoutMs;
    while (this.deps.now() < end) {
      if (await this.eval<boolean>(`!!(${expr})`).catch(() => false)) return;
      await this.deps.sleep(200);
    }
    throw new Error(`timed out waiting for ${expr}`);
  }

  /** Viewport PNG. */
  async shot(path: string) {
    const r = (await this.send('browsingContext.captureScreenshot', { context: this.context })) as { data: string };
    await this.deps.write(path, Buffer.from(r.data, 'base64'));
  }

  /** Quits the browser the way its menu would, so shutdown work such as writing a startup profile runs. */
  quit(): Promise<void> {
    return (this.closing ??= (async () => {
      this.unhook();
      await this.send('browser.close', {}, 30_000).catch(() => {});
      await this.deps.unlink(this.sessionFile).catch(() => {});
      await this.hangUp();
    })());
  }

  /** Ends the session; an unconfirmed end keeps the id file, so the next run rejoins instead of hitting the one-session limit. */
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.unhook();
      // Firefox drops the session's sockets as it ends it, so losing the socket after sending also counts.
      const ended = this.up && (await this.send('session.end', {}, 5000).then(() => true, () => this.lost != null));
      if (ended) await this.deps.unlink(this.sessionFile).catch(() => {});
      else console.error(`BiDi: session.end unconfirmed; ${this.sessionFile} kept for the next run to rejoin`);
      await this.hangUp();
    })());
  }

  private async hangUp() {
    this.ws.close();
    await Promise.race([this.shut, this.deps.sleep(1000)]);
  }
}
