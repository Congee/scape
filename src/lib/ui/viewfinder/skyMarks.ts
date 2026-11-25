import type { PreparedConstellations } from '@core/astro/constellations';
import { activeShowers, radiantEquatorial, type ShowerStatus } from '@core/astro/meteors';
import { applyStar, poleEnu, starFrame, type StarFrame } from '@core/astro/skyFrame';
import { eqjVector, starRadiusPx, type StarCatalog } from '@core/astro/stars';
import { arcWindow, rainbowArc, rainbowRadiusDeg, rainbowTop, WATER_N } from '@core/astro/rainbow';
import { flatHorizonDeg } from '@core/terrain/los';
import { hexRgba, OverlayFlag } from '@core/viewfinder/gl/overlayGl';
import { clamp } from '@core/viewfinder/palette';
import { behindBuilding, hiddenBySkyline, inView, placeEnu, toPx } from '@core/viewfinder/place';
import { segmentHitsRect } from '@core/viewfinder/segmentRect';
import { compositionStore } from '@state/composition';
import { skyStore } from '@state/sky';
import { FONT_SANS } from '../inks';
import { clipToArea, haloText, type Paint, type Scene } from './paint';

const D2R = Math.PI / 180;
const DAY_MS = 86_400_000;
/** Red to violet; each colour's own index sets its radius, so the secondary comes out reversed. */
const BOW_COLORS = ['#e8453c', '#f59a23', '#f2dc3c', '#4cc35a', '#3a8ee8', '#8a5cd6'];
const BOW_STEPS = 240;
const HORIZON_RGBA = [230 / 255, 237 / 255, 243 / 255, 0.35] as const;

interface StarGroup {
  rgba: [number, number, number, number];
  idx: number[];
}

/** What the sky painters keep between frames. */
export interface SkyMemo {
  starGroups: { cat: StarCatalog; groups: StarGroup[]; polaris: number } | null;
  showers: { day: number; list: ShowerStatus[] } | null;
}

/** Horizon (0°) as a faint dashed line, over the ground. */
export function drawHorizon(p: Paint, sc: Scene) {
  const pts: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const az = sc.aim.azimuthDeg - sc.hfov * 0.75 + (sc.hfov * 1.5 * i) / 40;
    const q = toPx(sc, az, 0);
    if (q) pts.push(q.x, q.y);
  }
  p.marks.dashed(pts, 1, 4, 6, OverlayFlag.Over, HORIZON_RGBA);
  // Out into the wider area as separate lines, so the dashes inside the frame keep their phase.
  const reach = sc.viewHfov * 0.75 - sc.hfov * 0.75;
  if (reach <= 0) return;
  for (const side of [-1, 1]) {
    const ext: number[] = [];
    for (let i = 0; i <= 40; i++) {
      const q = toPx(sc, sc.aim.azimuthDeg + side * (sc.hfov * 0.75 + (reach * i) / 40), 0);
      if (q) ext.push(q.x, q.y);
    }
    p.marks.dashed(ext, 1, 4, 6, OverlayFlag.Over, HORIZON_RGBA);
  }
}

/** Primary and secondary bows as colour bands; dashed and dim where terrain or a building is in front. */
export function drawRainbow(p: Paint, sc: Scene) {
  const minAlt = flatHorizonDeg(sc.eyeAboveGroundM) - 0.5;
  const seen = { clear: 0, dim: 0 };
  for (const [k, alpha] of [[1, 0.8], [2, 0.45]] as const) {
    const mid = rainbowRadiusDeg(WATER_N.Yellow, k);
    if (!rainbowTop(sc.sunAz, sc.sunAlt, mid).possible) continue;
    const width = Math.abs(rainbowRadiusDeg(WATER_N.Red, k) - rainbowRadiusDeg(WATER_N.Violet, k));
    // Sample only what the frame can show, so long lenses keep a smooth arc.
    const range = arcWindow(sc.sunAz, sc.sunAlt, mid, sc.aim.azimuthDeg, sc.aim.elevationDeg, Math.hypot(sc.viewHfov, sc.viewVfov) / 2 + width);
    if (!range) continue;
    const centre = rainbowArc(sc.sunAz, sc.sunAlt, mid, -90, BOW_STEPS, range);
    const hidden = centre.map((q) => q.altitudeDeg < minAlt || hiddenBySkyline(sc, q.azimuthDeg, q.altitudeDeg) || behindBuilding(p.occ, q.azimuthDeg, q.altitudeDeg, Infinity));
    const lineWidth = Math.max(1.5, (sc.frame.pxPerMm * sc.cam.focalMm * width * D2R) / (BOW_COLORS.length - 1));
    BOW_COLORS.forEach((color, ci) => {
      const n = WATER_N.Red + ((WATER_N.Violet - WATER_N.Red) * ci) / (BOW_COLORS.length - 1);
      const pts = rainbowArc(sc.sunAz, sc.sunAlt, rainbowRadiusDeg(n, k), -90, BOW_STEPS, range);
      const rgba = hexRgba(color, alpha);
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i].altitudeDeg >= minAlt ? toPx(sc, pts[i].azimuthDeg, pts[i].altitudeDeg) : null;
        if (q && prev && segmentHitsRect(prev, q, sc.area, 40)) {
          const dim = hidden[i] || hidden[i - 1];
          if (inView(sc, q)) seen[dim ? 'dim' : 'clear']++;
          p.marks.segment(prev.x, prev.y, q.x, q.y, lineWidth, OverlayFlag.Over | (dim ? OverlayFlag.Hidden : 0), alpha * 0.35, rgba);
        }
        prev = q;
      }
    });
  }
  if (import.meta.env.DEV) {
    const dev = (window as unknown as { __scape?: Record<string, unknown> }).__scape;
    if (dev) dev.rainbow = { ...seen, at: Date.now() };
  }
}

/** Stars, constellation figures, the pole, trails and meteor radiants once the sky is dark enough. */
export function drawSky(p: Paint, sc: Scene, memo: SkyMemo) {
  const c = compositionStore.getState();
  if (sc.night <= 0 || !(c.showStars || c.showConstellations || c.showTrails || c.showRadiants)) return;
  const sky = skyStore.getState();
  sky.ensure();
  clipToArea(p.ctx, sc.area);
  const M = starFrame(sc.time, sc.obs);
  if (c.showConstellations && sky.constellations) drawConstellations(p, sc, M, sky.constellations);
  if (c.showTrails && sky.stars) drawTrails(p, sc, sky.stars);
  if (c.showStars && sky.stars) drawStars(p, sc, M, sky.stars, c.showStarNames, memo);
  if (c.showStars) drawPole(p, sc);
  if (c.showRadiants) drawRadiants(p, sc, M, memo);
  p.ctx.restore();
}

/** Stars bucketed by colour and brightness so the canvas style changes a few dozen times, not 9k. */
function groupsFor(cat: StarCatalog, memo: SkyMemo): { groups: StarGroup[]; polaris: number } {
  if (memo.starGroups?.cat === cat) return memo.starGroups;
  const map = new Map<string, StarGroup>();
  let polaris = -1;
  for (let i = 0; i < cat.n; i++) {
    const r = cat.rgb[i * 3];
    const g = cat.rgb[i * 3 + 1];
    const b = cat.rgb[i * 3 + 2];
    const m = cat.mag[i];
    const alpha = m <= 1 ? 1 : m <= 2.5 ? 0.88 : m <= 4 ? 0.7 : m <= 5.2 ? 0.5 : 0.36;
    const key = `${r >> 4},${g >> 4},${b >> 4},${alpha}`;
    let grp = map.get(key);
    if (!grp) {
      grp = { rgba: [((r >> 4) * 16 + 8) / 255, ((g >> 4) * 16 + 8) / 255, ((b >> 4) * 16 + 8) / 255, alpha], idx: [] };
      map.set(key, grp);
    }
    grp.idx.push(i);
    if (cat.names.get(i) === 'Polaris') polaris = i;
  }
  memo.starGroups = { cat, groups: [...map.values()], polaris };
  return memo.starGroups;
}

/** Faintest magnitude worth drawing: wider frames and moonlight both hide the faint end. */
function magLimit(sc: Scene): number {
  return clamp(4.6 + 60 / sc.hfov, 4.5, 6.5) - 1.5 * sc.moonFactor;
}

const behindEnu = (p: Paint, v: Float64Array) => !!p.occ && p.occ.occludes(v[0], v[1], v[2], Infinity);

function drawStars(p: Paint, sc: Scene, M: StarFrame, cat: StarCatalog, names: boolean, memo: SkyMemo) {
  const { ctx } = p;
  const { groups, polaris } = groupsFor(cat, memo);
  const limit = magLimit(sc);
  const out = new Float64Array(3);
  const labels: { x: number; y: number; name: string }[] = [];
  const rgba: [number, number, number, number] = [0, 0, 0, 0];
  for (const g of groups) {
    rgba[0] = g.rgba[0];
    rgba[1] = g.rgba[1];
    rgba[2] = g.rgba[2];
    rgba[3] = g.rgba[3] * sc.night;
    for (const i of g.idx) {
      if (cat.mag[i] > limit) break;
      applyStar(M, cat.x[i], cat.y[i], cat.z[i], out);
      const q = placeEnu(sc, p.occ, out[0], out[1], out[2], 4, false);
      if (!q || q.hidden) continue;
      const r = starRadiusPx(cat.mag[i]);
      if (r < 1.1) p.marks.box(q.x, q.y, r, rgba);
      else p.marks.disc(q.x, q.y, r, rgba);
      p.probe?.push(0, q.x, q.y, r, behindEnu(p, out) ? 1 : 0, 0);
      if (names && (cat.mag[i] <= 1.6 || i === polaris) && cat.names.has(i) && !behindEnu(p, out)) labels.push({ x: q.x, y: q.y, name: cat.names.get(i)! });
    }
  }
  ctx.globalAlpha = sc.night;
  ctx.fillStyle = 'rgba(230,237,243,0.8)';
  ctx.font = `10px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  for (const l of labels) haloText(ctx, l.name, l.x + 5, l.y - 4);
  ctx.globalAlpha = 1;
}

function drawConstellations(p: Paint, sc: Scene, M: StarFrame, pc: PreparedConstellations) {
  const { ctx } = p;
  const a = new Float64Array(3);
  const b = new Float64Array(3);
  const seg = pc.segments;
  const rgba = [160 / 255, 150 / 255, 230 / 255, 0.5 * sc.night] as const;
  for (let s = 0; s < seg.length; s += 6) {
    applyStar(M, seg[s], seg[s + 1], seg[s + 2], a);
    applyStar(M, seg[s + 3], seg[s + 4], seg[s + 5], b);
    const q = placeEnu(sc, p.occ, a[0], a[1], a[2], 600, false);
    const r = placeEnu(sc, p.occ, b[0], b[1], b[2], 600, false);
    if (!q || !r || q.hidden || r.hidden) continue;
    p.marks.segment(q.x, q.y, r.x, r.y, 1, 0, 0, rgba);
  }
  ctx.globalAlpha = sc.night;
  if (sc.hfov > 20) {
    ctx.fillStyle = 'rgba(180,170,240,0.7)';
    ctx.font = `italic 11px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < pc.ids.length; i++) {
      applyStar(M, pc.centres[i * 3], pc.centres[i * 3 + 1], pc.centres[i * 3 + 2], a);
      const q = placeEnu(sc, p.occ, a[0], a[1], a[2], 0);
      if (q && !q.hidden) haloText(ctx, pc.names[i], q.x, q.y);
    }
  }
  ctx.globalAlpha = 1;
}

function drawPole(p: Paint, sc: Scene) {
  const [e, n, u] = poleEnu(sc.time, sc.obs);
  const q = placeEnu(sc, p.occ, e, n, u, 0);
  if (!q || q.hidden) return;
  const { ctx } = p;
  ctx.globalAlpha = sc.night;
  ctx.strokeStyle = 'rgba(230,237,243,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
  ctx.moveTo(q.x - 9, q.y);
  ctx.lineTo(q.x + 9, q.y);
  ctx.moveTo(q.x, q.y - 9);
  ctx.lineTo(q.x, q.y + 9);
  ctx.stroke();
  // Below the mark: Polaris' own label sits above-right, less than a degree away.
  ctx.fillStyle = 'rgba(230,237,243,0.7)';
  ctx.font = `10px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  haloText(ctx, 'Celestial pole', q.x, q.y + 11);
  ctx.globalAlpha = 1;
}

/** Trails of the brighter stars over the chosen span, starting at the simulated time. */
function drawTrails(p: Paint, sc: Scene, cat: StarCatalog) {
  const c = compositionStore.getState();
  const steps = clamp(Math.round(c.trailMinutes / 3), 6, 40);
  const dtMs = (c.trailMinutes * 60_000) / steps;
  const mats: StarFrame[] = [];
  for (let k = 0; k <= steps; k++) mats.push(starFrame(new Date(sc.time.getTime() + k * dtMs), sc.obs, mats[0]?.beta));
  const limit = Math.min(4.5, magLimit(sc));
  const out = new Float64Array(3);
  const run: number[] = [];
  const rgba: [number, number, number, number] = [0, 0, 0, 0.55 * sc.night];
  // One run of joined segments, round only at its two ends so the joins do not blend twice.
  const flush = (width: number) => {
    const last = run.length / 2 - 1;
    for (let k = 0; k < last; k++) {
      const flags = (k === 0 ? OverlayFlag.RoundStart : 0) | (k === last - 1 ? OverlayFlag.RoundEnd : 0);
      p.marks.segment(run[2 * k], run[2 * k + 1], run[2 * k + 2], run[2 * k + 3], width, flags, 0, rgba);
    }
    run.length = 0;
  };
  for (let i = 0; i < cat.n && cat.mag[i] <= limit; i++) {
    rgba[0] = cat.rgb[i * 3] / 255;
    rgba[1] = cat.rgb[i * 3 + 1] / 255;
    rgba[2] = cat.rgb[i * 3 + 2] / 255;
    const width = Math.max(0.7, starRadiusPx(cat.mag[i]) * 0.9);
    for (const m of mats) {
      applyStar(m, cat.x[i], cat.y[i], cat.z[i], out);
      const q = placeEnu(sc, p.occ, out[0], out[1], out[2], 40, false);
      if (q && !q.hidden) run.push(q.x, q.y);
      else if (run.length > 0) flush(width);
    }
    if (run.length > 0) flush(width);
  }
}

function drawRadiants(p: Paint, sc: Scene, M: StarFrame, memo: SkyMemo) {
  const t = sc.time.getTime();
  const day = Math.floor(t / DAY_MS);
  if (!memo.showers || memo.showers.day !== day) memo.showers = { day, list: activeShowers(t) };
  if (memo.showers.list.length === 0) return;
  const { ctx } = p;
  const out = new Float64Array(3);
  ctx.font = `11px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1.2;
  for (const st of memo.showers.list) {
    const { raDeg, decDeg } = radiantEquatorial({ ...st, daysFromPeak: (t - st.peakMs) / DAY_MS });
    const [x, y, z] = eqjVector(raDeg, decDeg);
    applyStar(M, x, y, z, out);
    const q = placeEnu(sc, p.occ, out[0], out[1], out[2], 20);
    if (!q) continue;
    ctx.globalAlpha = (q.hidden ? 0.35 : 0.9) * sc.night;
    ctx.strokeStyle = '#ffe08a';
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ctx.moveTo(q.x + 8 * Math.cos(a), q.y + 8 * Math.sin(a));
      ctx.lineTo(q.x + 13 * Math.cos(a), q.y + 13 * Math.sin(a));
    }
    ctx.stroke();
    haloText(ctx, `${st.shower.name} · ZHR ${st.shower.zhr ?? 'variable'}`, q.x + 16, q.y);
  }
  ctx.globalAlpha = 1;
}
