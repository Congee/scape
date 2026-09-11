import { makeObserver } from '@core/astro/bodies';
import { position } from '@core/astro/positions';
import { horizonAngleAt } from '@core/terrain/horizon';
import { formatTime } from '@core/time/format';
import { dayDataStore } from '@state/dayData';
import { settingsStore } from '@state/settings';
import { horizonKeyFor, terrainStore } from '@state/terrain';
import { worldStore } from '@state/world';

const PAD = { l: 30, r: 10, t: 18, b: 16 };
const ALT_MAX = 90;
const ALT_MIN = -60;
const COLORS = {
  night: '#0b0e12',
  astro: '#10151c',
  nautical: '#161d27',
  civil: '#1e2a38',
  day: '#26384f',
  grid: '#2a333e',
  horizon: '#4a5866',
  text: '#9aa7b4',
  sun: '#f5a524',
  moon: '#5aa9ff',
  gc: '#b48cff',
  cursor: '#e6edf3',
  now: '#8fd18c',
  terrain: '#8fd18c'
};

function bandColor(sunAlt: number): string {
  if (sunAlt > 0) return COLORS.day;
  if (sunAlt > -6) return COLORS.civil;
  if (sunAlt > -12) return COLORS.nautical;
  if (sunAlt > -18) return COLORS.astro;
  return COLORS.night;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Canvas altitude chart with scrub and keyboard nudge. Subscribes to the stores directly. */
export class ChartController {
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private unsubs: (() => void)[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private dragging = false;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.unsubs.push(
      dayDataStore.subscribe(() => this.schedule()),
      worldStore.subscribe(() => this.schedule()),
      settingsStore.subscribe(() => this.schedule()),
      terrainStore.subscribe(() => this.schedule())
    );
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('keydown', this.onKey);
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
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.draw();
  }

  private x(t: number, start: number, end: number) {
    return PAD.l + ((t - start) / (end - start)) * (this.w - PAD.l - PAD.r);
  }

  private y(alt: number) {
    return PAD.t + ((ALT_MAX - alt) / (ALT_MAX - ALT_MIN)) * (this.h - PAD.t - PAD.b);
  }

  private timeAt(clientX: number) {
    const r = this.canvas.getBoundingClientRect();
    const { dayStart, dayEnd } = dayDataStore.getState();
    const f = clamp((clientX - r.left - PAD.l) / (this.w - PAD.l - PAD.r), 0, 1);
    return dayStart + f * (dayEnd - dayStart);
  }

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus();
    this.dragging = true;
    worldStore.getState().setTime(this.timeAt(e.clientX));
  };

  private onMove = (e: PointerEvent) => {
    if (this.dragging) worldStore.getState().setTime(this.timeAt(e.clientX));
  };

  private onUp = () => {
    this.dragging = false;
  };

  private onKey = (e: KeyboardEvent) => {
    const w = worldStore.getState();
    const step = e.altKey ? 3_600_000 : e.shiftKey ? 600_000 : 60_000;
    if (e.key === 'ArrowLeft') w.nudgeTime(-step);
    else if (e.key === 'ArrowRight') w.nudgeTime(step);
    else if (e.key === 'PageUp') w.addDays(-1);
    else if (e.key === 'PageDown') w.addDays(1);
    else return;
    e.preventDefault();
  };

  private draw() {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { dayStart, dayEnd, curve, events } = dayDataStore.getState();
    const world = worldStore.getState();
    const cfg = settingsStore.getState();
    const { time, tz, pin, pinHeightM } = world;
    const { hour12, showGc } = cfg;
    if (dayEnd <= dayStart || w < 40) return;
    const X = (t: number) => this.x(t, dayStart, dayEnd);
    const curveOk = curve && curve.startMs === dayStart;

    // Twilight bands from the sun curve.
    if (curveOk) {
      for (let i = 0; i < curve.n - 1; i++) {
        const t0 = curve.startMs + i * curve.stepMs;
        ctx.fillStyle = bandColor(curve.altitude.sun[i]);
        const x0 = X(t0);
        ctx.fillRect(x0, PAD.t, X(t0 + curve.stepMs) - x0 + 0.5, h - PAD.t - PAD.b);
      }
    } else {
      ctx.fillStyle = COLORS.astro;
      ctx.fillRect(PAD.l, PAD.t, w - PAD.l - PAD.r, h - PAD.t - PAD.b);
    }

    // Grid: every 3 hours, altitude lines at 0/30/60.
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    for (let t = dayStart; t <= dayEnd; t += 3 * 3_600_000) {
      const x = Math.round(X(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, h - PAD.b);
      ctx.stroke();
      if (t < dayEnd) ctx.fillText(formatTime(t, tz, hour12).replace(':00', ''), x, h - PAD.b + 3);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const alt of [60, 30, -30]) {
      const y = Math.round(this.y(alt)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(w - PAD.r, y);
      ctx.stroke();
      ctx.fillText(`${alt}°`, PAD.l - 4, y);
    }
    const y0 = Math.round(this.y(0)) + 0.5;
    ctx.strokeStyle = COLORS.horizon;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y0);
    ctx.lineTo(w - PAD.r, y0);
    ctx.stroke();
    ctx.fillText('0°', PAD.l - 4, y0);

    // Terrain horizon along the sun's path (filled) and the moon's path (dashed).
    const t = terrainStore.getState();
    const hk = horizonKeyFor(world, cfg);
    const horizon = curveOk && hk && t.horizon && t.horizonKey === hk ? t.horizon.profile : null;
    if (curveOk && horizon) {
      const trace = (b: 'sun' | 'moon') => {
        ctx.beginPath();
        const azs = curve.azimuth[b];
        for (let i = 0; i < curve.n; i++) {
          const x = X(curve.startMs + i * curve.stepMs);
          const y = this.y(clamp(horizonAngleAt(horizon, azs[i]), ALT_MIN, ALT_MAX));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };
      trace('sun');
      ctx.lineTo(X(dayEnd), h - PAD.b);
      ctx.lineTo(X(dayStart), h - PAD.b);
      ctx.closePath();
      ctx.fillStyle = 'rgba(143, 209, 140, 0.16)';
      ctx.fill();
      ctx.lineWidth = 1;
      trace('sun');
      ctx.strokeStyle = 'rgba(143, 209, 140, 0.85)';
      ctx.stroke();
      trace('moon');
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(143, 209, 140, 0.6)';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (curveOk) {
      const bodies: Array<['sun' | 'moon' | 'gc', string, number]> = [
        ['gc', COLORS.gc, 1.5],
        ['moon', COLORS.moon, 2],
        ['sun', COLORS.sun, 2]
      ];
      for (const [b, color, width] of bodies) {
        if (b === 'gc' && !showGc) continue;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(b === 'gc' ? [4, 3] : []);
        ctx.beginPath();
        const alts = curve.altitude[b];
        for (let i = 0; i < curve.n; i++) {
          const x = X(curve.startMs + i * curve.stepMs);
          const y = this.y(clamp(alts[i], ALT_MIN, ALT_MAX));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Rise/set markers: geometric ones on the 0° line, terrain ones where the limb meets the skyline.
    for (const ev of events) {
      if (ev.body === 'gc' && !showGc) continue;
      const terrainEv = ev.kind === 'terrainRise' || ev.kind === 'terrainSet';
      if (!terrainEv && ev.kind !== 'rise' && ev.kind !== 'set') continue;
      const x = X(ev.time);
      const y = terrainEv ? this.y(clamp(ev.altitude, ALT_MIN, ALT_MAX)) : y0;
      if (terrainEv) {
        ctx.strokeStyle = COLORS.terrain;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = COLORS[ev.body];
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Real "now" marker when today is displayed.
    const now = Date.now();
    if (now >= dayStart && now < dayEnd) {
      const x = Math.round(X(now)) + 0.5;
      ctx.strokeStyle = COLORS.now;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, h - PAD.b);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Cursor with current body altitudes.
    if (time >= dayStart && time < dayEnd) {
      const x = Math.round(X(time)) + 0.5;
      ctx.strokeStyle = COLORS.cursor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t - 4);
      ctx.lineTo(x, h - PAD.b);
      ctx.stroke();
      ctx.fillStyle = COLORS.cursor;
      ctx.textBaseline = 'top';
      ctx.textAlign = x > w - 60 ? 'right' : x < 60 ? 'left' : 'center';
      ctx.fillText(formatTime(time, tz, hour12), x, 2);
      const obs = makeObserver(pin, pinHeightM);
      const date = new Date(time);
      for (const b of ['sun', 'moon', 'gc'] as const) {
        if (b === 'gc' && !showGc) continue;
        const alt = position(b, date, obs).altitude;
        if (alt < ALT_MIN) continue;
        ctx.fillStyle = COLORS[b];
        ctx.beginPath();
        ctx.arc(x, this.y(alt), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('keydown', this.onKey);
  }
}
