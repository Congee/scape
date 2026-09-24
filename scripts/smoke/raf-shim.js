// Smoke init script: a locked or covered display hides the window and stalls rAF, so drive frames by message loop.
(() => {
  if (document.visibilityState !== 'hidden' || window.smokeRafShim) return;
  window.smokeRafShim = true;
  const q = new Map();
  let id = 0, last = 0;
  const ch = new MessageChannel();
  ch.port1.addEventListener('message', () => {
    const now = performance.now();
    if (now - last >= 16) {
      last = now;
      const cbs = [...q.values()];
      q.clear();
      for (const f of cbs) try { f(now); } catch (e) { console.error(e); }
    }
    if (q.size) ch.port2.postMessage(0);
  });
  ch.port1.start();
  window.requestAnimationFrame = (f) => { q.set(++id, f); if (q.size === 1) ch.port2.postMessage(0); return id; };
  window.cancelAnimationFrame = (i) => { q.delete(i); };
})();
