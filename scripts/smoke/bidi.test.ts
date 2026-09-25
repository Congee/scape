import { afterEach, describe, expect, it, vi } from 'vitest';
import { BidiTab, Signals, type BidiDeps, type Socket } from './bidi';

type Cmd = { id: number; method: string; params: Record<string, unknown> };
/** What the fake Firefox does with a command: a reply, silence, or dropping the socket. */
type Answer = { result: Record<string, unknown> } | { error: string; message: string } | 'hang' | 'drop';
type Firefox = (cmd: Cmd, url: string) => Answer;

const firefox =
  (over: Partial<Record<string, Answer>> = {}): Firefox =>
  ({ method }) =>
    over[method] ??
    { result: { 'session.new': { sessionId: 's1' }, 'browsingContext.getTree': { contexts: [{ context: 'ctx1' }] } }[method] ?? {} };

class FakeSocket implements Socket {
  readyState = 0;
  sent: Cmd[] = [];
  private fns = new Map<string, ((e: { data?: unknown }) => void)[]>();

  constructor(
    readonly url: string,
    private ff: Firefox
  ) {}

  addEventListener(type: string, fn: (e: { data?: unknown }) => void) {
    this.fns.set(type, [...(this.fns.get(type) ?? []), fn]);
  }
  emit(type: string, e: { data?: unknown } = {}) {
    for (const fn of this.fns.get(type) ?? []) fn(e);
  }
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  message(m: unknown) {
    this.emit('message', { data: typeof m === 'string' ? m : JSON.stringify(m) });
  }
  send(data: string) {
    const cmd = JSON.parse(data) as Cmd;
    this.sent.push(cmd);
    const a = this.ff(cmd, this.url);
    if (a === 'hang') return;
    queueMicrotask(() => {
      if (a === 'drop') this.close();
      else if ('error' in a) this.message({ type: 'error', id: cmd.id, ...a });
      else this.message({ type: 'success', id: cmd.id, result: a.result });
    });
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }
  methods() {
    return this.sent.map((c) => c.method);
  }
}

/** Fake deps; sockets open on the next microtask unless `connect` says otherwise. */
function harness(ff = firefox(), connect: (s: FakeSocket) => void = (s) => queueMicrotask(() => s.open())) {
  const sockets: FakeSocket[] = [];
  const timers = new Set<{ fn: () => void; ms: number }>();
  const files = new Map<string, string>();
  const on = new Map<string, ((e?: unknown) => void)[]>();
  const exits: number[] = [];
  const deps: BidiDeps = {
    socket: (url) => {
      const s = new FakeSocket(url, ff);
      sockets.push(s);
      connect(s);
      return s;
    },
    setTimeout: (fn, ms) => {
      const t = { fn, ms };
      timers.add(t);
      return t;
    },
    clearTimeout: (t) => void timers.delete(t as { fn: () => void; ms: number }),
    sleep: () => Promise.resolve(),
    now: () => 0,
    read: async (p) => files.get(p) ?? Promise.reject(new Error('ENOENT')),
    write: async (p, d) => void files.set(p, String(d)),
    unlink: async (p) => void files.delete(p),
    proc: {
      on: (ev, fn) => on.set(ev, [...(on.get(ev) ?? []), fn]),
      off: (ev, fn) => on.set(ev, (on.get(ev) ?? []).filter((f) => f !== fn)),
      exit: (code) => void exits.push(code)
    }
  };
  /** Fires the pending timers set for `ms`. */
  const fire = (ms: number) => {
    for (const t of timers)
      if (t.ms === ms) {
        timers.delete(t);
        t.fn();
      }
  };
  const listeners = (ev: string) => on.get(ev) ?? [];
  return { deps, sockets, timers, files, exits, fire, listeners, open: () => BidiTab.open(9432, '/s', deps) };
}

afterEach(() => vi.restoreAllMocks());

describe('BidiTab.open', () => {
  it('starts a session, saves its id and finds the tab', async () => {
    const h = harness();
    const tab = await h.open();
    expect(h.sockets[0].url).toBe('ws://127.0.0.1:9432/session');
    expect(h.sockets[0].methods()).toEqual(['session.new', 'browsingContext.getTree']);
    expect(h.files.get('/s')).toBe('s1');
    expect(tab.context).toBe('ctx1');
    for (const ev of ['SIGHUP', 'SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException']) expect(h.listeners(ev)).toHaveLength(1);
    expect(h.timers.size).toBe(0);
  });

  it('names the port when nothing answers on it', async () => {
    const h = harness(firefox(), (s) =>
      queueMicrotask(() => {
        s.emit('error');
        s.close();
      })
    );
    await expect(h.open()).rejects.toThrow(/cannot connect BiDi at ws:\/\/127\.0\.0\.1:9432\/session: connection failed .*port 9432: start it/);
  });

  it('gives up on a handshake that never finishes', async () => {
    const h = harness(firefox(), () => {});
    const p = h.open();
    h.fire(10_000);
    await expect(p).rejects.toThrow(/no handshake in 10000 ms/);
    expect(h.sockets[0].readyState).toBe(3);
  });

  it('rejoins the saved session when Firefox allows no second one', async () => {
    const h = harness((cmd, url) =>
      url.endsWith('/session') && cmd.method === 'session.new' ? { error: 'session not created', message: 'Maximum number of active sessions' } : firefox()(cmd, url)
    );
    h.files.set('/s', 'old\n');
    const tab = await h.open();
    expect(h.sockets.map((s) => s.url)).toEqual(['ws://127.0.0.1:9432/session', 'ws://127.0.0.1:9432/session/old']);
    expect(h.sockets[0].readyState).toBe(3);
    expect(h.sockets[1].methods()).toEqual(['browsingContext.getTree']);
    expect(tab.context).toBe('ctx1');
  });

  it('explains a held session it has no id for', async () => {
    const h = harness(firefox({ 'session.new': { error: 'session not created', message: 'Maximum number of active sessions' } }));
    await expect(h.open()).rejects.toThrow(/another client holds the session on port 9432/);
    expect(h.sockets[0].readyState).toBe(3);
  });

  it('explains a saved session that is gone', async () => {
    const h = harness(firefox({ 'session.new': { error: 'session not created', message: 'Maximum number of active sessions' } }), (s) =>
      queueMicrotask(() => (s.url.endsWith('/session') ? s.open() : s.close()))
    );
    h.files.set('/s', 'old');
    await expect(h.open()).rejects.toThrow(/session old from \/s is gone or held by another client/);
  });

  it('ends the session when finding the tab fails', async () => {
    const h = harness(firefox({ 'browsingContext.getTree': { error: 'unknown error', message: 'boom' } }));
    await expect(h.open()).rejects.toThrow('browsingContext.getTree: unknown error boom');
    expect(h.sockets[0].methods()).toContain('session.end');
    expect(h.listeners('SIGINT')).toHaveLength(0);
  });
});

describe('BidiTab.send', () => {
  it('times out on the injected timer and ignores a late reply', async () => {
    const h = harness(firefox({ 'script.evaluate': 'hang' }));
    const tab = await h.open();
    const p = tab.send('script.evaluate', {}, 1234);
    h.fire(1234);
    await expect(p).rejects.toThrow('script.evaluate timed out after 1234 ms');
    expect(() => h.sockets[0].message({ type: 'success', id: 3, result: {} })).not.toThrow();
  });

  it('rejects every pending command when the socket closes', async () => {
    const h = harness(firefox({ 'script.evaluate': 'hang', 'browsingContext.navigate': 'hang' }));
    const tab = await h.open();
    const a = tab.send('script.evaluate');
    const b = tab.navigate('http://x/');
    h.sockets[0].close();
    await expect(a).rejects.toThrow('script.evaluate: BiDi socket ws://127.0.0.1:9432/session closed');
    await expect(b).rejects.toThrow('browsingContext.navigate: BiDi socket');
    expect(h.timers.size).toBe(0);
    await expect(tab.send('script.evaluate')).rejects.toThrow('closed');
  });

  it('rejects pending commands on a socket error', async () => {
    const h = harness(firefox({ 'script.evaluate': 'hang' }));
    const tab = await h.open();
    const p = tab.send('script.evaluate');
    h.sockets[0].emit('error');
    await expect(p).rejects.toThrow('failed');
  });

  it('survives junk and id-less errors from the browser', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tab = await harness().open();
    const s = (tab as unknown as { ws: FakeSocket }).ws;
    s.message('not json');
    s.message({ type: 'error', id: null, error: 'invalid argument', message: 'bad' });
    expect(err).toHaveBeenCalledTimes(2);
    await expect(tab.send('session.status')).resolves.toEqual({});
  });
});

describe('BidiTab.close', () => {
  it('ends the session, removes its file, closes the socket and unhooks', async () => {
    const h = harness();
    const tab = await h.open();
    await Promise.all([tab.close(), tab.close()]);
    expect(h.sockets[0].methods().filter((m) => m === 'session.end')).toHaveLength(1);
    expect(h.files.has('/s')).toBe(false);
    expect(h.sockets[0].readyState).toBe(3);
    for (const ev of ['SIGHUP', 'SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException']) expect(h.listeners(ev)).toHaveLength(0);
  });

  it('counts a socket dropped right after session.end as ended', async () => {
    const h = harness(firefox({ 'session.end': 'drop' }));
    await (await h.open()).close();
    expect(h.files.has('/s')).toBe(false);
  });

  it('keeps the file for a rejoin when session.end times out', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(firefox({ 'session.end': 'hang' }));
    const tab = await h.open();
    const p = tab.close();
    h.fire(5000);
    await p;
    expect(h.files.get('/s')).toBe('s1');
    expect(h.sockets[0].readyState).toBe(3);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('/s kept'));
  });

  it('keeps the file when the socket was already gone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness();
    const tab = await h.open();
    h.sockets[0].close();
    await tab.close();
    expect(h.sockets[0].methods()).not.toContain('session.end');
    expect(h.files.get('/s')).toBe('s1');
  });
});

describe('BidiTab.quit', () => {
  it('closes the browser and forgets the session', async () => {
    const h = harness(firefox({ 'browser.close': 'drop' }));
    const tab = await h.open();
    await tab.quit();
    await tab.close();
    expect(h.sockets[0].methods()).toEqual(['session.new', 'browsingContext.getTree', 'browser.close']);
    expect(h.files.has('/s')).toBe(false);
  });
});

describe('interrupts', () => {
  it.each(Object.entries(Signals))('%s ends the session, then exits %i', async (sig, code) => {
    const h = harness();
    const tab = await h.open();
    h.listeners(sig)[0]();
    await tab.close();
    await Promise.resolve();
    expect(h.sockets[0].methods()).toContain('session.end');
    expect(h.files.has('/s')).toBe(false);
    expect(h.exits).toEqual([code]);
    expect(h.listeners(sig)).toHaveLength(0);
  });

  it('logs an unhandled rejection, ends the session and exits 1', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness();
    const tab = await h.open();
    const boom = new Error('boom');
    h.listeners('unhandledRejection')[0](boom);
    await tab.close();
    await Promise.resolve();
    expect(err).toHaveBeenCalledWith(boom);
    expect(h.sockets[0].methods()).toContain('session.end');
    expect(h.exits).toEqual([1]);
  });
});

describe('BidiTab.until', () => {
  it('polls on the injected clock until the deadline', async () => {
    let t = 0;
    const h = harness(firefox({ 'script.evaluate': { result: { type: 'success', result: { type: 'string', value: 'false' } } } }));
    h.deps.now = () => t;
    h.deps.sleep = async () => void (t += 200);
    const tab = await h.open();
    await expect(tab.until('x', 1000)).rejects.toThrow('timed out waiting for x');
    expect(h.sockets[0].methods().filter((m) => m === 'script.evaluate')).toHaveLength(5);
  });
});
