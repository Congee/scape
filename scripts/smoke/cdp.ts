// A minimal CDP client for one tab: the shared agent-browser daemon hops between agents' browsers, so smokes drive their own tab.
/* oxlint-disable no-await-in-loop -- CDP steps are sequential */

// A locked screen occludes the window and stops rAF; worker timers keep ticking, so they drive frames then.
const RAF_WHEN_HIDDEN = `(() => {
  if (document.visibilityState !== 'hidden') return;
  let q = [], id = 0;
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 16)'], { type: 'text/javascript' })));
  w.onmessage = () => { const run = q; q = []; const t = performance.now(); for (const [, cb] of run) cb(t); };
  window.requestAnimationFrame = (cb) => (q.push([++id, cb]), id);
  window.cancelAnimationFrame = (h) => { q = q.filter(([i]) => i !== h); };
})();`;

type Msg = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string };

export class Tab {
  private seq = 0;
  private waiters = new Map<number, (m: Msg) => void>();
  private workers = new Map<string, string>();
  private offline = false;
  private logging = false;
  /** False keeps the tab in the background: Page.bringToFront can raise the window over the user's. */
  private front = false;
  /** URLs the page and its workers requested since `logRequests()`. */
  readonly requests: string[] = [];

  private constructor(
    private ws: WebSocket,
    readonly targetId: string
  ) {
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as Msg;
      if (m.id != null) this.waiters.get(m.id)?.(m);
      if (m.method === 'Network.requestWillBeSent' && this.logging) this.requests.push(String((m.params as { request: { url: string } }).request.url));
      if (m.method === 'Target.attachedToTarget') {
        const p = m.params as { sessionId: string; targetInfo?: { url?: string } };
        void this.adopt(String(p.sessionId), p.targetInfo?.url ?? '').catch(() => {});
      }
      if (m.method === 'Target.detachedFromTarget') this.workers.delete(String((m.params as { sessionId: string }).sessionId));
    });
  }

  /** The tab already on `origin`, or a new background tab, which opens no window. */
  static async open(cdp: number, origin: string, { front = false } = {}): Promise<Tab> {
    const list = (await (await fetch(`http://localhost:${cdp}/json/list`)).json()) as { id: string; type: string; url: string }[];
    let id = list.find((t) => t.type === 'page' && t.url.startsWith(origin))?.id;
    if (!id) {
      const b = await Tab.connect(((await (await fetch(`http://localhost:${cdp}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl, '');
      id = String((await b.send('Target.createTarget', { url: 'about:blank', background: true })).targetId);
      b.ws.close();
    }
    const tab = await Tab.connect(`ws://localhost:${cdp}/devtools/page/${id}`, id);
    tab.front = front;
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: RAF_WHEN_HIDDEN });
    // A worker another client left waiting for its debugger never starts; attach and release it.
    await tab.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    return tab;
  }

  private static connect(url: string, id: string): Promise<Tab> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Tab(ws, id)));
      ws.addEventListener('error', () => reject(new Error(`cannot connect ${url}`)));
    });
  }

  private async adopt(sessionId: string, url: string) {
    this.workers.set(sessionId, url);
    if (this.offline) await this.emulate(true, sessionId);
    if (this.logging) await this.send('Network.enable', {}, sessionId);
    await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
    await this.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.waiters.set(id, (m) => {
        clearTimeout(timer);
        this.waiters.delete(id);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`));
        else resolve(m.result ?? {});
      });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }

  async eval<T = unknown>(expression: string, timeoutMs = 60_000): Promise<T> {
    const r = (await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, undefined, timeoutMs)) as { result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Polls a page expression until it is truthy; returns its last value. */
  async until<T = unknown>(expression: string, timeoutMs = 60_000, everyMs = 500): Promise<T | null> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        const v = await this.eval<T>(expression, 10_000);
        if (v) return v;
      } catch {
        // The page may be mid-navigation.
      }
      await Bun.sleep(everyMs);
    }
    return null;
  }

  // Hidden tabs get no rAF, and a stray new tab can take the front, so each load re-activates.
  async navigate(url: string) {
    await this.send('Page.navigate', { url });
    await this.activate();
    await this.until('document.readyState === "complete"', 30_000, 250);
  }

  async reload() {
    await this.send('Page.reload', { ignoreCache: false });
    await this.activate();
    await Bun.sleep(500);
    await this.until('document.readyState === "complete"', 30_000, 250);
  }

  async activate() {
    if (this.front) await this.send('Page.bringToFront');
  }

  async viewport(width: number, height: number, deviceScaleFactor = 2) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
  }

  /** PNG of the page, or of a CSS-pixel rect of it. */
  async shot(path: string, clip?: { x: number; y: number; width: number; height: number }): Promise<string> {
    const r = (await this.send('Page.captureScreenshot', { format: 'png', ...(clip && { clip: { ...clip, scale: 1 } }) })) as { data: string };
    await Bun.write(path, Buffer.from(r.data, 'base64'));
    return r.data;
  }

  /** Records every request of the page and the workers it starts from now on. */
  async logRequests() {
    this.requests.length = 0;
    this.logging = true;
    await this.send('Network.enable');
  }

  /** Network.emulateNetworkConditions on the page and every worker it runs. */
  async setOffline(on: boolean) {
    this.offline = on;
    await this.emulate(on);
    for (const s of this.workers.keys()) await this.emulate(on, s).catch(() => {});
  }

  private async emulate(offline: boolean, sessionId?: string) {
    await this.send('Network.enable', {}, sessionId);
    await this.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
  }

  /** Attached worker sessions and their script URLs. */
  workerSessions(): [string, string][] {
    return [...this.workers];
  }

  close() {
    this.ws.close();
  }
}
