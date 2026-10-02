import { distance, height, type Units } from '@core/format';
import { sightlineHeightM } from '@core/terrain/los';
import { settingsStore } from '@state/settings';
import { profileKeyFor, terrainStore } from '@state/terrain';
import { worldStore } from '@state/world';
import type { ProfileResult } from '@workers/terrain.protocol';
import { FONT_SANS } from './inks';

const PAD = { l: 44, r: 10, t: 10, b: 18 };
const C = {
  ground: 'rgba(143, 209, 140, 0.35)',
  groundLine: '#8fd18c',
  hidden: 'rgba(255, 92, 92, 0.28)',
  sight: '#e6edf3',
  pin: '#e5322d',
  pin2: '#8fd18c',
  text: '#9aa7b4',
  grid: '#2a333e'
};

/** Canvas elevation profile between the pins with the sight line and hidden ground tinted. */
export class ProfileController {
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private unsubs: (() => void)[] = [];
  private w = 0;
  private h = 0;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.unsubs.push(
      terrainStore.subscribe(() => this.schedule()),
      worldStore.subscribe((st) => profileKeyFor(st, settingsStore.getState()), () => this.schedule()),
      settingsStore.subscribe((s) => s.units, () => this.schedule())
    );
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (w < 60) return;
    const world = worldStore.getState();
    const t = terrainStore.getState();
    const units = settingsStore.getState().units;
    const fresh = t.profile && t.profileKey === profileKeyFor(world, settingsStore.getState());
    ctx.font = `10px ${FONT_SANS}`;
    ctx.fillStyle = C.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!fresh) {
      ctx.fillText(t.busy.Profile ? 'Loading elevation profile…' : 'No profile', w / 2, h / 2);
      return;
    }
    this.drawProfile(t.profile!, units);
  }

  private drawProfile(p: ProfileResult, units: Units) {
    const { ctx, w, h } = this;
    const n = p.distM.length;
    const D = p.distM[n - 1];
    const ground = Array.from(p.groundM, (g) => (Number.isNaN(g) ? 0 : g));
    let lo = Math.min(p.eyeM, p.targetM, ...ground);
    let hi = Math.max(p.eyeM, p.targetM, ...ground);
    const span = Math.max(hi - lo, 20);
    lo -= span * 0.08;
    hi += span * 0.12;
    const X = (d: number) => PAD.l + (d / D) * (w - PAD.l - PAD.r);
    const Y = (m: number) => PAD.t + ((hi - m) / (hi - lo)) * (h - PAD.t - PAD.b);
    const base = h - PAD.b;

    // Ground fill and skyline.
    ctx.beginPath();
    ctx.moveTo(X(0), base);
    for (let i = 0; i < n; i++) ctx.lineTo(X(p.distM[i]), Y(ground[i]));
    ctx.lineTo(X(D), base);
    ctx.closePath();
    ctx.fillStyle = C.ground;
    ctx.fill();
    // Ground the eye cannot see.
    ctx.fillStyle = C.hidden;
    for (let i = 1; i < n; i++) {
      if (p.los.visible[i]) continue;
      const x0 = X(p.distM[i - 1]);
      ctx.fillRect(x0, Y(ground[i]), X(p.distM[i]) - x0 + 0.5, base - Y(ground[i]));
    }
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = X(p.distM[i]);
      const y = Y(ground[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = C.groundLine;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Sight line, curved with the Earth like the analysis.
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const d = p.distM[i];
      const x = X(d);
      const y = Y(sightlineHeightM(d, p.eyeM, p.los.targetAngleDeg));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = C.sight;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // Eye and target.
    for (const [x, y, c] of [
      [X(0), Y(p.eyeM), C.pin],
      [X(D), Y(p.targetM), C.pin2]
    ] as const) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Axes.
    ctx.fillStyle = C.text;
    ctx.font = `10px ${FONT_SANS}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('0', X(0), base + 3);
    ctx.textAlign = 'center';
    ctx.fillText(distance(D / 2, units), X(D / 2), base + 3);
    ctx.textAlign = 'right';
    ctx.fillText(distance(D, units), X(D), base + 3);
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = C.grid;
    for (const m of [lo + span * 0.08, hi - span * 0.12]) {
      const y = Math.round(Y(m)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(w - PAD.r, y);
      ctx.stroke();
      ctx.fillText(height(m, units), PAD.l - 4, y);
    }
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }
}
