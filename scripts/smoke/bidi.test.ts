import { afterEach, describe, expect, it, vi } from 'vitest';
import { BidiTab, Signals, type BidiDeps, type Socket } from './bidi';

type Cmd = { id: number; method: string; params: Record<string, unknown> };
/** What the fake Firefox does with a command: a reply, silence, dropping the socket, or a reply and then dropping it. */
type Answer = { result: Record<string, unknown> } | { error: string; message: string } | 'hang' | 'drop' | 'end';
type Firefox = (cmd: Cmd, url: string) => Answer;

/** Firefox 156 as observed: session.end replies, then closes the socket. */
const firefox =
  (over: Partial<Record<string, Answer>> = {}): Firefox =>
  ({ method }) =>
    over[method] ??
    (method === 'session.end' ? 'end' : undefined) ??
    { result: { 'session.new': { sessionId: 's1' }, 'browsingContext.getTree': { contexts: [{ context: 'ctx1' }] } }[method] ?? {} };

type Ev = { data?: unknown; code?: number; reason?: string };

class FakeSocket implements Socket {
  readyState = 0;
  sent: Cmd[] = [];
  private fns = new Map<string, ((e: Ev) => void)[]>();

  constructor(
    readonly url: string,
    private ff: Firefox
  ) {}

  addEventListener(type: string, fn: (e: Ev) => void) {
    this.fns.set(type, [...(this.fns.get(type) ?? []), fn]);
  }
  emit(type: string, e: Ev = {}) {
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
      else if (a === 'end') {
        this.message({ type: 'success', id: cmd.id, result: {} });
        this.close();
      } else if ('error' in a) this.message({ type: 'error', id: cmd.id, ...a });
      else this.message({ type: 'success', id: cmd.id, result: a.result });
    });
  }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code, reason });
  }
  methods() {
    return this.sent.map((c) => c.method);
  }
}

/** Fake deps; sockets open on the next microtask unless `connect` says otherwise. */
function harness(ff = firefox(), connect: (s: FakeSocket) => void = (s) => queueMicrotask(() => s.open())) {
  const sockets: FakeSocket[] = [];
  const timers = new Set<{ fn: () => void; ms: number }>();
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
    write: async () => {},
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
  return { deps, sockets, timers, exits, fire, listeners, open: () => BidiTab.open(9432, deps) };
}

afterEach(() => vi.restoreAllMocks());

const held = { error: 'session not created', message: 'Maximum number of active sessions' };
/** How Bun reports a failed handshake: an error, then a close whose reason says why. */
const refuse = (code: number, reason: string) => (s: FakeSocket) =>
  queueMicrotask(() => {
    s.emit('error');
    s.close(code, reason);
  });

describe('BidiTab.open', () => {
  it('starts a BiDi-only session and finds the tab', async () => {
    const h = harness();
    const tab = await h.open();
    expect(h.sockets.map((s) => s.url)).toEqual(['ws://127.0.0.1:9432/session']);
    expect(h.sockets[0].sent.map((c) => [c.method, c.params])).toEqual([
      ['session.new', { capabilities: {} }],
      ['browsingContext.getTree', { maxDepth: 0 }]
    ]);
    expect(tab.context).toBe('ctx1');
    for (const ev of ['SIGHUP', 'SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException']) expect(h.listeners(ev)).toHaveLength(1);
    expect(h.timers.size).toBe(0);
  });

  it('names the port when nothing listens on it', async () => {
    const h = harness(firefox(), refuse(1006, 'Failed to connect'));
    await expect(h.open()).rejects.toThrow(/cannot connect BiDi at ws:\/\/127\.0\.0\.1:9432\/session: Failed to connect .*port 9432: start it/);
  });

  it('passes on why a server that is not Firefox refused the upgrade', async () => {
    const h = harness(firefox(), refuse(1002, 'Expected 101 status code'));
    await expect(h.open()).rejects.toThrow(/9432\/session: Expected 101 status code \(no Firefox remote agent on port 9432/);
  });

  it('falls back to the close code without a reason', async () => {
    const h = harness(firefox(), refuse(1006, ''));
    await expect(h.open()).rejects.toThrow('9432/session: connection closed (1006)');
  });

  it('gives up on a handshake that never finishes', async () => {
    const h = harness(firefox(), () => {});
    const p = h.open();
    h.fire(10_000);
    await expect(p).rejects.toThrow(/no handshake in 10000 ms/);
    expect(h.sockets[0].readyState).toBe(3);
  });

  it('says to restart Firefox when an orphaned session holds the only slot', async () => {
    const h = harness(firefox({ 'session.new': held }));
    await expect(h.open()).rejects.toThrow(/Maximum number of active sessions \(Firefox on port 9432 still holds a session .*restart that Firefox/);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].methods()).toEqual(['session.new']);
    expect(h.sockets[0].readyState).toBe(3);
    expect(h.listeners('SIGINT')).toHaveLength(0);
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
  it('ends the session once, closes the socket and unhooks', async () => {
    const err = vi.spyOn(console, 'error');
    const h = harness();
    const tab = await h.open();
    await Promise.all([tab.close(), tab.close()]);
    expect(h.sockets[0].methods().filter((m) => m === 'session.end')).toHaveLength(1);
    expect(h.sockets[0].readyState).toBe(3);
    expect(err).not.toHaveBeenCalled();
    for (const ev of ['SIGHUP', 'SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException']) expect(h.listeners(ev)).toHaveLength(0);
  });

  it.each([
    ['times out', 'hang'],
    ['drops the socket unanswered', 'drop']
  ] as const)('warns the session may linger when session.end %s', async (_, a) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(firefox({ 'session.end': a }));
    const tab = await h.open();
    const p = tab.close();
    h.fire(5000);
    await p;
    expect(h.sockets[0].readyState).toBe(3);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/^BiDi: session\.end.*; Firefox on port 9432 may keep the session until it restarts$/));
  });

  it('warns without sending when the socket was already gone', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness();
    const tab = await h.open();
    h.sockets[0].close();
    await tab.close();
    expect(h.sockets[0].methods()).not.toContain('session.end');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('may keep the session'));
  });
});

describe('BidiTab.quit', () => {
  it('closes the browser and forgets the session', async () => {
    const h = harness(firefox({ 'browser.close': 'drop' }));
    const tab = await h.open();
    await tab.quit();
    await tab.close();
    expect(h.sockets[0].methods()).toEqual(['session.new', 'browsingContext.getTree', 'browser.close']);
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
