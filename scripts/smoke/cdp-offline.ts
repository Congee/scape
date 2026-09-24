// Holds the app's tab and its workers offline through CDP until killed; the emulation ends with this session.
// Usage: bun scripts/smoke/cdp-offline.ts <cdp> <port>
const [cdp = '9338', port = '5280'] = process.argv.slice(2);
const targets: { type: string; url: string; webSocketDebuggerUrl: string }[] = await (await fetch(`http://localhost:${cdp}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.startsWith(`http://localhost:${port}/`));
if (!page) throw new Error(`no page on localhost:${port}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const send = (method: string, params: object = {}, sessionId?: string) => ws.send(JSON.stringify({ id: ++seq, method, params, ...(sessionId && { sessionId }) }));
const offline = (sessionId?: string) => {
  send('Network.enable', {}, sessionId);
  send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
};

ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data));
  if (m.method !== 'Target.attachedToTarget') return;
  // Workers fetch through their own sessions.
  offline(m.params.sessionId);
  send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, m.params.sessionId);
  send('Runtime.runIfWaitingForDebugger', {}, m.params.sessionId);
});
ws.addEventListener('open', () => {
  offline();
  send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  console.log('offline');
});
ws.addEventListener('close', () => process.exit(0));
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => ws.close());
