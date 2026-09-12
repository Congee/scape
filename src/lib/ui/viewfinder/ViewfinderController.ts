import { shallow } from 'zustand/shallow';
import { BODIES, makeObserver, SkyBody } from '@core/astro/bodies';
import { moonInfo, position } from '@core/astro/positions';
import { SEMIDIAMETER_DEG } from '@core/astro/terrainEvents';
import { compass, degrees, distance } from '@core/format';
import { bearingDeg, distanceM, elevationAngleDeg, type LngLat } from '@core/geo/geodesy';
import { frameFov, frameMm } from '@core/optics/fov';
import { cameraBasis, discRadiusMm, project, unproject, type Camera, type CameraBasis } from '@core/optics/projection';
import type { SavedMarker } from '@core/plan';
import { flatHorizonDeg } from '@core/terrain/los';
import { columnAt, occluded, surfaceAt, type ViewProfile } from '@core/terrain/view';
import { formatTime } from '@core/time/format';
import { aimFor, compositionStore, type Aim } from '@state/composition';
import { dayDataStore } from '@state/dayData';
import { gearStore, sensorById } from '@state/gear';
import { markersStore } from '@state/markers';
import { settingsStore } from '@state/settings';
import { EYE_HEIGHT_M, profileKeyFor, terrainStore } from '@state/terrain';
import { viewfinderStore, type ViewWindow } from '@state/viewfinder';
import { worldStore } from '@state/world';
import { CATEGORY_COLORS } from '../map/overlays';

const D2R = Math.PI / 180;
const MARGIN = 26;
const MAX_COLUMNS = 2400;
const BODY_COLOR: Record<SkyBody, string> = { Sun: '#f5a524', Moon: '#9ccbff', Gc: '#b48cff' };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  pxPerMm: number;
}

interface Scene {
  cam: Camera;
  basis: CameraBasis;
  aim: Aim;
  frame: Frame;
  hfov: number;
  vfov: number;
  view: ViewProfile | null;
  eyeM: number;
  eyeAboveGroundM: number;
  sunAlt: number;
}

/** Synthetic camera view: terrain layers from the DEM sweep, sky, sun/moon/GC paths, target and markers. */
export class ViewfinderController {
  private ctx: CanvasRenderingContext2D;
  private raster = document.createElement('canvas');
  private ro: ResizeObserver;
  private unsubs: (() => void)[] = [];
  private raf = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private drag: { x: number; y: number; az: number; el: number } | null = null;
  private quality = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    const bump = () => {
      this.ensureWindow();
      this.schedule();
    };
    this.unsubs.push(
      worldStore.subscribe(bump),
      compositionStore.subscribe(bump),
      gearStore.subscribe(bump),
      settingsStore.subscribe(bump),
      terrainStore.subscribe(() => this.schedule()),
      dayDataStore.subscribe(() => this.schedule()),
      markersStore.subscribe((s) => s.markers, () => this.schedule(), { equalityFn: shallow })
    );
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDouble);
    canvas.addEventListener('keydown', this.onKey);
    this.ensureWindow();
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
    this.ensureWindow();
    this.draw();
  }

  /** Frame with the sensor's aspect ratio, centred with room for the tick rulers. */
  private frameRect(frameWmm: number, frameHmm: number): Frame {
    const availW = Math.max(40, this.w - 2 * MARGIN);
    const availH = Math.max(40, this.h - 2 * MARGIN);
    const scale = Math.min(availW / frameWmm, availH / frameHmm);
    const w = frameWmm * scale;
    const h = frameHmm * scale;
    return { x: (this.w - w) / 2, y: (this.h - h) / 2, w, h, pxPerMm: scale };
  }

  private scene(): Scene {
    const w = worldStore.getState();
    const c = compositionStore.getState();
    const s = settingsStore.getState();
    const t = terrainStore.getState();
    const sensor = sensorById(c.sensorId, gearStore.getState().cameras);
    const fm = frameMm(sensor, c.orientation);
    const fov = frameFov(sensor, c.focalMm, c.orientation);
    const fresh = t.profile && t.profileKey === profileKeyFor(w, s) ? t.profile : null;
    const aim = aimFor(c, w, fresh?.los.targetAngleDeg ?? null);
    const cam: Camera = { azimuthDeg: aim.azimuthDeg, elevationDeg: aim.elevationDeg, focalMm: c.focalMm, frameWmm: fm.w, frameHmm: fm.h };
    const eyeAboveGroundM = w.pinHeightM + EYE_HEIGHT_M;
    // Only a sweep made for this camera position may be drawn; a stale one from elsewhere would lie.
    const here = `${w.pin.lat.toFixed(4)},${w.pin.lng.toFixed(4)}|${eyeAboveGroundM}`;
    const view = s.terrain && t.view && t.viewKey.startsWith(here) ? t.view : null;
    const ground = t.pinGroundM ?? 0;
    const eyeM = view?.eyeM ?? Math.max(Number.isNaN(ground) ? 0 : ground, 0) + eyeAboveGroundM;
    const sunAlt = position(SkyBody.Sun, new Date(w.time), makeObserver(w.pin, w.pinHeightM)).altitude;
    return { cam, basis: cameraBasis(cam), aim, frame: this.frameRect(fm.w, fm.h), hfov: fov.hDeg, vfov: fov.vDeg, view: view?.profile ?? null, eyeM, eyeAboveGroundM, sunAlt };
  }

  /** Asks the terrain worker for a wedge wider than the frame so small pans need no new sweep. */
  private ensureWindow() {
    const s = settingsStore.getState();
    if (!s.terrain || this.w < 40) return;
    const sc = this.scene();
    const wantStep = clamp(sc.hfov / Math.max(100, sc.frame.w), 0.02, 0.5);
    const wantSpan = Math.min(360, Math.max(30, sc.hfov * 2 + 10));
    const stepForSpan = Math.max(wantStep, wantSpan / MAX_COLUMNS);
    const rangeM = s.horizonRangeKm * 1000;
    const minStepDeg = Math.max(0.005, sc.vfov / Math.max(100, sc.frame.h) / 2);
    const cur = viewfinderStore.getState().window;
    const needFrom = sc.aim.azimuthDeg - sc.hfov / 2 - 5;
    const needTo = sc.aim.azimuthDeg + sc.hfov / 2 + 5;
    if (cur && cur.rangeM === rangeM && cur.minStepDeg === minStepDeg && cur.azStepDeg <= stepForSpan * 1.3 && cur.azStepDeg >= stepForSpan / 3) {
      const rel = (a: number) => (((a - cur.azFromDeg) % 360) + 360) % 360;
      const covered = cur.azSpanDeg >= 360 || (rel(needFrom) <= cur.azSpanDeg && rel(needTo) <= cur.azSpanDeg && rel(needFrom) <= rel(needTo));
      if (covered) return;
    }
    const win: ViewWindow = {
      azFromDeg: (((sc.aim.azimuthDeg - wantSpan / 2) % 360) + 360) % 360,
      azSpanDeg: wantSpan,
      azStepDeg: stepForSpan,
      rangeM,
      minStepDeg
    };
    viewfinderStore.getState().setWindow(win);
  }

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus();
    const sc = this.scene();
    this.drag = { x: e.clientX, y: e.clientY, az: sc.aim.azimuthDeg, el: sc.aim.elevationDeg };
    this.quality = 0.5;
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const sc = this.scene();
    const degPerPx = sc.hfov / sc.frame.w;
    const az = this.drag.az - (e.clientX - this.drag.x) * degPerPx;
    const el = this.drag.el + (e.clientY - this.drag.y) * degPerPx;
    compositionStore.getState().aim(az, el);
  };

  private onUp = () => {
    this.drag = null;
    this.quality = 1;
    this.schedule();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const c = compositionStore.getState();
    const factor = Math.exp(-e.deltaY * 0.0015);
    c.update({ focalMm: Math.round(clamp(c.focalMm * factor, 4, 2400) * 10) / 10 });
  };

  private onDouble = (e: MouseEvent) => {
    const sc = this.scene();
    const r = this.canvas.getBoundingClientRect();
    const xMm = (e.clientX - r.left - sc.frame.x - sc.frame.w / 2) / sc.frame.pxPerMm;
    const yMm = (sc.frame.y + sc.frame.h / 2 - (e.clientY - r.top)) / sc.frame.pxPerMm;
    const d = unproject(sc.cam, sc.basis, xMm, yMm);
    compositionStore.getState().aim(d.azimuthDeg, d.altitudeDeg);
  };

  private onKey = (e: KeyboardEvent) => {
    const c = compositionStore.getState();
    const sc = this.scene();
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') c.aim(sc.aim.azimuthDeg - step, sc.aim.elevationDeg);
    else if (e.key === 'ArrowRight') c.aim(sc.aim.azimuthDeg + step, sc.aim.elevationDeg);
    else if (e.key === 'ArrowUp') c.aim(sc.aim.azimuthDeg, sc.aim.elevationDeg + step);
    else if (e.key === 'ArrowDown') c.aim(sc.aim.azimuthDeg, sc.aim.elevationDeg - step);
    else if (e.key === '+' || e.key === '=') c.update({ focalMm: Math.round(clamp(c.focalMm * 1.1, 4, 2400) * 10) / 10 });
    else if (e.key === '-') c.update({ focalMm: Math.round(clamp(c.focalMm / 1.1, 4, 2400) * 10) / 10 });
    else return;
    e.preventDefault();
  };

  private toPx(sc: Scene, azDeg: number, altDeg: number): { x: number; y: number } | null {
    const p = project(sc.cam, sc.basis, azDeg, altDeg);
    if (!p) return null;
    return { x: sc.frame.x + sc.frame.w / 2 + p.x * sc.frame.pxPerMm, y: sc.frame.y + sc.frame.h / 2 - p.y * sc.frame.pxPerMm };
  }

  private inFrame(sc: Scene, p: { x: number; y: number } | null, slack = 0): p is { x: number; y: number } {
    return !!p && p.x >= sc.frame.x - slack && p.x <= sc.frame.x + sc.frame.w + slack && p.y >= sc.frame.y - slack && p.y <= sc.frame.y + sc.frame.h + slack;
  }

  /** Sky and layered terrain, one pixel at a time at reduced resolution, then scaled into the frame. */
  private drawRaster(sc: Scene) {
    const { frame, view } = sc;
    const rw = Math.max(2, Math.round(frame.w * this.quality * Math.min(this.dpr, 1.5) * 0.6));
    const rh = Math.max(2, Math.round((rw * frame.h) / frame.w));
    this.raster.width = rw;
    this.raster.height = rh;
    const rctx = this.raster.getContext('2d')!;
    const img = rctx.createImageData(rw, rh);
    const data = img.data;

    const day = smooth(-12, 4, sc.sunAlt);
    const dusk = smooth(-10, -3, sc.sunAlt) * (1 - smooth(-1, 6, sc.sunAlt));
    // Sky and ground palettes for this sun altitude.
    const zenithDay = [46, 96, 168];
    const horizonDay = [176, 205, 232];
    const zenithNight = [6, 9, 18];
    const horizonNight = [22, 30, 48];
    const duskGlow = [236, 132, 72];
    const groundNear = mix([18, 22, 24], [86, 96, 70], day);
    const groundFar = mix([26, 34, 52], [150, 170, 200], day);
    const skyAt = (alt: number) => {
      const t = smooth(0, 60, alt);
      let c = mix(mix(horizonNight, zenithNight, t), mix(horizonDay, zenithDay, t), day);
      const glow = dusk * (1 - smooth(0, 18, alt));
      c = mix(c, duskGlow, glow * 0.6);
      return c;
    };
    const groundAt = (distM: number, slope: number) => {
      const haze = 1 - Math.exp(-distM / 45_000);
      const c = mix(groundNear, groundFar, haze);
      const shade = 0.75 + 0.5 * clamp(slope, 0, 1);
      return [c[0] * shade, c[1] * shade, c[2] * shade];
    };

    const { forward: F, right: R, up: U } = sc.basis;
    const f = sc.cam.focalMm;
    const fallback = flatHorizonDeg(sc.eyeAboveGroundM);
    let k = 0;
    for (let py = 0; py < rh; py++) {
      const yMm = ((0.5 - (py + 0.5) / rh) * frame.h) / frame.pxPerMm;
      for (let px = 0; px < rw; px++) {
        const xMm = (((px + 0.5) / rw - 0.5) * frame.w) / frame.pxPerMm;
        const vx = F.x + (xMm / f) * R.x + (yMm / f) * U.x;
        const vy = F.y + (xMm / f) * R.y + (yMm / f) * U.y;
        const vz = F.z + (xMm / f) * R.z + (yMm / f) * U.z;
        const len = Math.hypot(vx, vy, vz);
        const alt = Math.asin(vz / len) / D2R;
        let c: number[];
        if (view) {
          const az = Math.atan2(vx, vy) / D2R;
          const col = columnAt(view, az);
          if (col < 0 || alt > view.skylineDeg[col]) c = skyAt(alt);
          else {
            const m = surfaceAt(view, col, alt);
            if (m < 0) c = groundAt(view.rangeM, 0);
            else {
              const prev = m > view.start[col] ? m - 1 : -1;
              const slope = prev >= 0 ? (view.angleDeg[m] - view.angleDeg[prev]) / Math.max(0.02, Math.log(view.distM[m] / Math.max(1, view.distM[prev])) * 8) : 0.4;
              c = groundAt(view.distM[m], slope);
            }
          }
        } else c = alt > fallback ? skyAt(alt) : groundAt(clamp(-sc.eyeAboveGroundM / Math.tan(Math.min(-0.001, alt * D2R)), 20, 50_000), 0.3);
        data[k++] = c[0];
        data[k++] = c[1];
        data[k++] = c[2];
        data[k++] = 255;
      }
    }
    rctx.putImageData(img, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.raster, frame.x, frame.y, frame.w, frame.h);
  }

  private drawRulers(sc: Scene) {
    const { ctx } = this;
    const { frame } = sc;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'rgba(230,237,243,0.7)';
    ctx.fillStyle = 'rgba(230,237,243,0.85)';
    ctx.lineWidth = 1;
    const fine = sc.hfov < 12 ? 0.5 : sc.hfov < 40 ? 1 : 5;
    const labelEvery = sc.hfov < 12 ? 2 : sc.hfov < 40 ? 5 : 15;
    const from = Math.floor((sc.aim.azimuthDeg - sc.hfov) / fine) * fine;
    for (let az = from; az <= sc.aim.azimuthDeg + sc.hfov; az += fine) {
      const p = this.toPx(sc, az, sc.aim.elevationDeg);
      if (!p || p.x < frame.x || p.x > frame.x + frame.w) continue;
      const major = Math.abs(az / labelEvery - Math.round(az / labelEvery)) < 1e-6;
      const x = Math.round(p.x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, frame.y);
      ctx.lineTo(x, frame.y + (major ? 10 : 5));
      ctx.stroke();
      if (major) {
        const norm = ((az % 360) + 360) % 360;
        const cardinal = norm % 45 === 0 ? compass(norm) : '';
        ctx.fillText(cardinal || `${Math.round(norm)}°`, x, frame.y - 3);
      }
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const altStep = sc.vfov < 10 ? 1 : sc.vfov < 30 ? 5 : 10;
    for (let alt = -80; alt <= 80; alt += altStep) {
      const p = this.toPx(sc, sc.aim.azimuthDeg, alt);
      if (!p || p.y < frame.y || p.y > frame.y + frame.h) continue;
      const y = Math.round(p.y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(frame.x, y);
      ctx.lineTo(frame.x + (alt === 0 ? 12 : 6), y);
      ctx.stroke();
      ctx.fillText(`${alt > 0 ? '+' : ''}${alt}°`, frame.x - 3, y);
    }
  }

  private drawPath(sc: Scene, body: SkyBody, color: string) {
    const { curve } = dayDataStore.getState();
    if (!curve) return;
    const { ctx } = this;
    const alts = curve.altitude[body];
    const azs = curve.azimuth[body];
    const world = worldStore.getState();
    const hour12 = settingsStore.getState().hour12;
    ctx.lineWidth = 1.5;
    let prev: { x: number; y: number } | null = null;
    let prevHidden = false;
    for (let i = 0; i < curve.n; i++) {
      const p = this.toPx(sc, azs[i], alts[i]);
      const inside = this.inFrame(sc, p, 40);
      const hidden = !!sc.view && (() => {
        const col = columnAt(sc.view!, azs[i]);
        return col >= 0 && alts[i] < sc.view!.skylineDeg[col];
      })();
      if (p && prev && (inside || this.inFrame(sc, prev, 40))) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = hidden || prevHidden ? 0.35 : 0.9;
        ctx.setLineDash(hidden || prevHidden ? [3, 4] : []);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      const t = curve.startMs + i * curve.stepMs;
      if (inside && p && new Date(t).getUTCMinutes() === 0 && t % 3_600_000 === (curve.startMs % 3_600_000 + (i * curve.stepMs)) % 3_600_000) {
        const label = formatTime(t, world.tz, hour12).replace(':00', '');
        ctx.globalAlpha = hidden ? 0.5 : 0.95;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, p.x + 4, p.y - 3);
      }
      prev = p;
      prevHidden = hidden;
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  private drawBody(sc: Scene, body: SkyBody, date: Date) {
    const w = worldStore.getState();
    const pos = position(body, date, makeObserver(w.pin, w.pinHeightM));
    const p = this.toPx(sc, pos.azimuth, pos.altitude);
    if (!this.inFrame(sc, p, 60)) return;
    const { ctx } = this;
    const col = sc.view ? columnAt(sc.view, pos.azimuth) : -1;
    const skyline = col >= 0 && sc.view ? sc.view.skylineDeg[col] : flatHorizonDeg(sc.eyeAboveGroundM);
    const hidden = pos.altitude + SEMIDIAMETER_DEG[body] < skyline;
    const r = Math.max(3, discRadiusMm(sc.cam, SEMIDIAMETER_DEG[body]) * sc.frame.pxPerMm);
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    ctx.globalAlpha = hidden ? 0.35 : 1;
    if (body === SkyBody.Gc) {
      ctx.strokeStyle = BODY_COLOR.Gc;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 10, p.y);
      ctx.lineTo(p.x + 10, p.y);
      ctx.moveTo(p.x, p.y - 10);
      ctx.lineTo(p.x, p.y + 10);
      ctx.stroke();
    } else if (body === SkyBody.Sun) {
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 4);
      g.addColorStop(0, 'rgba(255,220,120,0.55)');
      g.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const info = moonInfo(date);
      ctx.fillStyle = '#2b3442';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Lit fraction as a lens shape; the bright limb faces the sun, i.e. west when waxing (northern view).
      const lit = info.illumination;
      const westSide = info.waxing ? 1 : -1;
      ctx.fillStyle = '#e8eef5';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, -Math.PI / 2, Math.PI / 2, westSide < 0);
      const rx = Math.abs(2 * lit - 1) * r;
      ctx.ellipse(p.x, p.y, Math.max(0.01, rx), r, 0, Math.PI / 2, -Math.PI / 2, (lit < 0.5) === westSide < 0);
      ctx.fill();
    }
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = BODY_COLOR[body];
    ctx.fillText(body === SkyBody.Gc ? 'Galactic Centre' : body === SkyBody.Sun ? 'Sun' : 'Moon', p.x, p.y + r + 4);
    ctx.restore();
  }

  private drawTarget(sc: Scene) {
    const w = worldStore.getState();
    if (!w.pin2) return;
    const t = terrainStore.getState();
    const s = settingsStore.getState();
    const fresh = t.profile && t.profileKey === profileKeyFor(w, s) ? t.profile : null;
    const az = bearingDeg(w.pin, w.pin2);
    const d = distanceM(w.pin, w.pin2);
    const ground2 = t.pin2GroundM;
    const alt = fresh ? fresh.los.targetAngleDeg : elevationAngleDeg(d, Math.max(ground2 ?? 0, 0) + w.pin2HeightM - sc.eyeM);
    const p = this.toPx(sc, az, alt);
    if (!this.inFrame(sc, p, 30)) return;
    const { ctx } = this;
    const blocked = fresh?.los.status === 'Blocked';
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    ctx.strokeStyle = blocked ? '#ff5c5c' : '#8fd18c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 9);
    ctx.lineTo(p.x + 9, p.y);
    ctx.lineTo(p.x, p.y + 9);
    ctx.lineTo(p.x - 9, p.y);
    ctx.closePath();
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillText(`Target · ${distance(d, s.units)}${blocked ? ' · behind terrain' : ''}`, p.x + 13, p.y);
    ctx.restore();
  }

  private drawMarkers(sc: Scene) {
    if (!compositionStore.getState().showMarkers) return;
    const w = worldStore.getState();
    const s = settingsStore.getState();
    const grounds = terrainStore.getState().markerGroundM;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const markers: SavedMarker[] = markersStore.getState().markers.filter((m) => m.showInViewfinder);
    for (const m of markers) {
      const d = distanceM(w.pin, m);
      if (d < 5) continue;
      const az = bearingDeg(w.pin, m);
      const g = grounds[m.id];
      const ground = g === undefined || Number.isNaN(g) ? null : Math.max(g, 0);
      // Without ground data the marker sits on the visible terrain surface at its distance.
      const baseAlt = ground != null ? elevationAngleDeg(d, ground - sc.eyeM) : this.surfaceAngle(sc, az, d);
      if (baseAlt == null) continue;
      const topAlt = ground != null ? elevationAngleDeg(d, ground + m.heightM - sc.eyeM) : baseAlt + (m.heightM / d) / D2R;
      const base = this.toPx(sc, az, baseAlt);
      const top = this.toPx(sc, az, topAlt);
      if (!base || !top || !(this.inFrame(sc, base, 20) || this.inFrame(sc, top, 20))) continue;
      const hidden = !!sc.view && occluded(sc.view, az, topAlt, d);
      const color = CATEGORY_COLORS[m.category];
      ctx.globalAlpha = hidden ? 0.4 : 1;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.5;
      const halfW = m.widthM > 0 ? (Math.atan(m.widthM / 2 / d) / D2R / sc.hfov) * sc.frame.w : 0;
      if (m.heightM > 0 || halfW > 0) {
        ctx.beginPath();
        ctx.rect(base.x - Math.max(halfW, 1), top.y, Math.max(halfW * 2, 2), Math.max(1, base.y - top.y));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(top.x, top.y - 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(top.x, top.y - 17, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(`${m.name} · ${distance(d, s.units)}`, top.x, top.y - 22);
    }
    ctx.restore();
  }

  /** Elevation angle of the terrain surface at a distance along an azimuth, from the sweep's visible points. */
  private surfaceAngle(sc: Scene, az: number, d: number): number | null {
    if (!sc.view) return flatHorizonDeg(sc.eyeAboveGroundM);
    const col = columnAt(sc.view, az);
    if (col < 0) return null;
    let best = sc.view.start[col];
    for (let m = sc.view.start[col]; m < sc.view.start[col + 1]; m++) {
      if (sc.view.distM[m] <= d) best = m;
      else break;
    }
    return sc.view.start[col] === sc.view.start[col + 1] ? null : sc.view.angleDeg[best];
  }

  private drawHud(sc: Scene) {
    const { ctx } = this;
    const w = worldStore.getState();
    const c = compositionStore.getState();
    const s = settingsStore.getState();
    const t = terrainStore.getState();
    const sensor = sensorById(c.sensorId, gearStore.getState().cameras);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(230,237,243,0.9)';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const y = sc.frame.y + sc.frame.h + 6;
    const narrow = sc.frame.w < 620;
    ctx.fillText(`${sensor.name} · ${c.focalMm} mm f/${c.fNumber} · ${sc.hfov.toFixed(1)}° × ${sc.vfov.toFixed(1)}°`, sc.frame.x, y);
    const aimText = `${degrees(sc.aim.azimuthDeg, 1)} ${compass(sc.aim.azimuthDeg)} · ${sc.aim.elevationDeg >= 0 ? '+' : ''}${degrees(sc.aim.elevationDeg, 1)}${sc.aim.locked ? ' · aimed at target' : ''}`;
    // Narrow frames stack the two readouts instead of letting them collide.
    ctx.textAlign = narrow ? 'left' : 'right';
    ctx.fillText(aimText, narrow ? sc.frame.x : sc.frame.x + sc.frame.w, narrow ? y + 15 : y);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(formatTime(w.time, w.tz, s.hour12), sc.frame.x + 6, sc.frame.y - 14 > 12 ? sc.frame.y - 14 : 12);
    let status = '';
    if (!s.terrain) status = 'Elevation data is off (Settings): flat horizon';
    else if (t.busy.View) status = 'Sweeping terrain…';
    else if (!sc.view) status = 'Waiting for terrain…';
    else if (t.view?.missing) status = `${t.view.missing} terrain tiles missing`;
    if (status) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(230,237,243,0.7)';
      ctx.fillText(status, sc.frame.x + sc.frame.w - 6, sc.frame.y - 14 > 12 ? sc.frame.y - 14 : 12);
    }
  }

  private draw() {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, w, h);
    if (w < 40 || h < 40) return;
    const sc = this.scene();
    const s = settingsStore.getState();
    const c = compositionStore.getState();
    this.drawRaster(sc);

    // Horizon (0°) as a faint dashed line.
    ctx.save();
    ctx.beginPath();
    ctx.rect(sc.frame.x, sc.frame.y, sc.frame.w, sc.frame.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(230,237,243,0.35)';
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 40; i++) {
      const az = sc.aim.azimuthDeg - sc.hfov * 0.75 + (sc.hfov * 1.5 * i) / 40;
      const p = this.toPx(sc, az, 0);
      if (!p) continue;
      if (!started) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      started = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (c.showPaths) {
      for (const b of BODIES) {
        if (b === SkyBody.Gc && !s.showGc) continue;
        this.drawPath(sc, b, BODY_COLOR[b]);
      }
    }
    ctx.restore();

    const date = new Date(worldStore.getState().time);
    for (const b of BODIES) {
      if (b === SkyBody.Gc && !s.showGc) continue;
      this.drawBody(sc, b, date);
    }
    this.drawMarkers(sc);
    this.drawTarget(sc);

    // Frame, thirds grid and centre mark.
    ctx.strokeStyle = 'rgba(230,237,243,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(sc.frame.x) + 0.5, Math.round(sc.frame.y) + 0.5, Math.round(sc.frame.w), Math.round(sc.frame.h));
    if (c.showGrid) {
      ctx.strokeStyle = 'rgba(230,237,243,0.25)';
      for (const f of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(sc.frame.x + sc.frame.w * f, sc.frame.y);
        ctx.lineTo(sc.frame.x + sc.frame.w * f, sc.frame.y + sc.frame.h);
        ctx.moveTo(sc.frame.x, sc.frame.y + sc.frame.h * f);
        ctx.lineTo(sc.frame.x + sc.frame.w, sc.frame.y + sc.frame.h * f);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(230,237,243,0.5)';
    const cx = sc.frame.x + sc.frame.w / 2;
    const cy = sc.frame.y + sc.frame.h / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy + 8);
    ctx.stroke();
    this.drawRulers(sc);
    this.drawHud(sc);
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDouble);
    this.canvas.removeEventListener('keydown', this.onKey);
  }
}

export type { LngLat };
