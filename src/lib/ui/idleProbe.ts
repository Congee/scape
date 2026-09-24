/** Dev-only counters for the quiet budget: rAF callbacks, and those that drew to a WebGL or 2D canvas. */
export interface IdleProbe {
  /** rAF callbacks run. */
  raf: number;
  /** rAF callbacks that issued at least one GL draw call. */
  glFrames: number;
  /** GL draw calls, inside rAF or not. */
  glDraws: number;
  /** 2D canvas fill/stroke/drawImage calls. */
  draws2d: number;
  /** Timer callbacks run (setTimeout and setInterval). */
  timers: number;
  /** When on, `sites` counts rAF and timer registrations by caller. */
  trace: boolean;
  sites: Record<string, number>;
  reset(): void;
}

export function installIdleProbe(): IdleProbe {
  const probe: IdleProbe = {
    raf: 0,
    glFrames: 0,
    glDraws: 0,
    draws2d: 0,
    timers: 0,
    trace: false,
    sites: {},
    reset() {
      probe.raf = probe.glFrames = probe.glDraws = probe.draws2d = probe.timers = 0;
      probe.sites = {};
    }
  };
  const site = (kind: string) => {
    if (!probe.trace) return;
    const at = `${kind} ${(new Error().stack ?? '').split('\n').slice(3, 6).map((l) => l.trim().replace(/\?[^:)]*/, '')).join(' < ')}`;
    probe.sites[at] = (probe.sites[at] ?? 0) + 1;
  };
  let inRaf = false;
  let drewThisRaf = false;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    site('raf');
    return raf((t) => {
      probe.raf++;
      inRaf = true;
      drewThisRaf = false;
      try {
        cb(t);
      } finally {
        inRaf = false;
        if (drewThisRaf) probe.glFrames++;
      }
    });
  };
  const wrapGl = (proto: object, names: string[]) => {
    const p = proto as Record<string, (...a: unknown[]) => unknown>;
    for (const n of names) {
      const f = p[n];
      if (typeof f !== 'function') continue;
      p[n] = function (this: unknown, ...a: unknown[]) {
        probe.glDraws++;
        if (inRaf) drewThisRaf = true;
        return f.apply(this, a);
      };
    }
  };
  const gl = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear'];
  wrapGl(WebGL2RenderingContext.prototype, gl);
  wrapGl(WebGLRenderingContext.prototype, gl);
  const c2d = CanvasRenderingContext2D.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const n of ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'drawImage', 'clearRect']) {
    const f = c2d[n];
    c2d[n] = function (this: unknown, ...a: unknown[]) {
      probe.draws2d++;
      return f.apply(this, a);
    };
  }
  const st = window.setTimeout.bind(window);
  const si = window.setInterval.bind(window);
  const count = (h: TimerHandler) => (typeof h === 'function' ? (...a: unknown[]) => (probe.timers++, (h as (...x: unknown[]) => unknown)(...a)) : h);
  window.setTimeout = ((h: TimerHandler, ms?: number, ...a: unknown[]) => (site(`timeout ${ms ?? 0}`), st(count(h), ms, ...a))) as typeof setTimeout;
  window.setInterval = ((h: TimerHandler, ms?: number, ...a: unknown[]) => (site(`interval ${ms ?? 0}`), si(count(h), ms, ...a))) as typeof setInterval;
  return probe;
}
