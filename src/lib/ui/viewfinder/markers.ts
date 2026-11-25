import { distance, height } from '@core/format';
import { bearingDeg, distanceM, elevationAngleDeg, heightAtAngle } from '@core/geo/geodesy';
import { pinFrame } from '@core/geo/pinFrame';
import { faceShade, facesToward, solidOf, type Solid } from '@core/geo/solids';
import { MarkerShape, type SavedMarker } from '@core/plan';
import { occluded } from '@core/terrain/view';
import { behindBuilding, inView, surfaceAngle, toPx } from '@core/viewfinder/place';
import { compositionStore } from '@state/composition';
import { markersStore } from '@state/markers';
import { settingsStore } from '@state/settings';
import { profileKeyFor, targetAngleFor, terrainStore } from '@state/terrain';
import { worldStore } from '@state/world';
import { FONT_SANS } from '../inks';
import { CATEGORY_COLORS } from '../map/overlays';
import { clipToArea, haloText, type Paint, type Scene } from './paint';

const D2R = Math.PI / 180;

/** Hex colour multiplied by a flat shade factor. */
const shaded = (hex: string, k: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${((n >> 16) & 255) * k | 0},${((n >> 8) & 255) * k | 0},${(n & 255) * k | 0})`;
};

/** The second pin as a diamond with its distance, red when terrain blocks it. */
export function drawTarget(p: Paint, sc: Scene) {
  const w = worldStore.getState();
  if (!w.pin2) return;
  const t = terrainStore.getState();
  const s = settingsStore.getState();
  const fresh = t.profile && t.profileKey === profileKeyFor(w, s) ? t.profile : null;
  const az = bearingDeg(w.pin, w.pin2);
  const d = distanceM(w.pin, w.pin2);
  const alt = targetAngleFor(w, s, t);
  if (alt == null) return;
  const q = toPx(sc, az, alt);
  if (!inView(sc, q, 30)) return;
  const { ctx } = p;
  const blocked = fresh?.los.status === 'Blocked';
  clipToArea(ctx, sc.area);
  ctx.strokeStyle = blocked ? '#ff5c5c' : '#8fd18c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(q.x, q.y - 9);
  ctx.lineTo(q.x + 9, q.y);
  ctx.lineTo(q.x, q.y + 9);
  ctx.lineTo(q.x - 9, q.y);
  ctx.closePath();
  ctx.stroke();
  ctx.font = `11px ${FONT_SANS}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ctx.strokeStyle;
  const label = `Target · ${distance(d, s.units)}${w.pin2HeightM > 0 ? ` · ${height(w.pin2HeightM, s.units)}` : ''}${blocked ? ' · behind terrain' : ''}`;
  const spills = q.x + 13 + ctx.measureText(label).width > sc.area.x + sc.area.w;
  ctx.textAlign = spills ? 'right' : 'left';
  haloText(ctx, label, spills ? q.x - 13 : q.x + 13, q.y);
  ctx.restore();
}

/** Saved markers as bars or flat-shaded solids, with a pin and name above each. */
export function drawMarkers(p: Paint, sc: Scene) {
  if (!compositionStore.getState().showMarkers) return;
  const w = worldStore.getState();
  const s = settingsStore.getState();
  const grounds = terrainStore.getState().markerGroundM;
  const { ctx } = p;
  clipToArea(ctx, sc.area);
  ctx.font = `11px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  // Flat shading follows the picked light (or the sun at dusk), else a fixed key light from the camera's left.
  const sunAz = sc.light?.azimuthDeg ?? (sc.sunAlt > -6 ? sc.sunAz : null);
  const markers: SavedMarker[] = markersStore.getState().markers.filter((m) => m.showInViewfinder);
  for (const m of markers) {
    const d = distanceM(w.pin, m);
    if (d < 5) continue;
    const az = bearingDeg(w.pin, m);
    const g = grounds[m.id];
    const ground = g === undefined || Number.isNaN(g) ? null : g;
    // Without ground data the marker sits on the visible terrain surface at its distance.
    const baseAlt = ground != null ? elevationAngleDeg(d, ground - sc.eyeM) : surfaceAngle(sc, az, d);
    if (baseAlt == null) continue;
    const topAlt = ground != null ? elevationAngleDeg(d, ground + m.heightM - sc.eyeM) : baseAlt + (m.heightM / d) / D2R;
    const base = toPx(sc, az, baseAlt);
    const top = toPx(sc, az, topAlt);
    const halfW = m.widthM > 0 ? (Math.atan(m.widthM / 2 / d) / D2R / sc.hfov) * sc.frame.w : 0;
    if (!base || !top || !(inView(sc, base, 20 + halfW) || inView(sc, top, 20 + halfW))) continue;
    const hidden = (!!sc.view && occluded(sc.view, az, topAlt, d)) || behindBuilding(p.occ, az, topAlt, d);
    p.seen.markers[m.id] = hidden;
    const color = CATEGORY_COLORS[m.category];
    ctx.globalAlpha = hidden ? 0.4 : 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    const shape = m.shape ?? MarkerShape.Bar;
    const solid = shape === MarkerShape.Bar ? null : solidOf(shape, { widthM: m.widthM, depthM: m.depthM ?? m.widthM, heightM: m.heightM, rotationDeg: m.rotationDeg ?? 0 });
    if (solid?.faces.length) {
      const groundM = ground ?? heightAtAngle(sc.eyeM, d, baseAlt);
      drawSolid(ctx, sc, m, solid, d, groundM, color, sunAz ?? bearingDeg(m, w.pin) + 90);
      ctx.fillStyle = color;
    } else if (m.heightM > 0 || halfW > 0) {
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
    haloText(ctx, `${m.name} · ${distance(d, s.units)}`, top.x, top.y - 22);
  }
  ctx.restore();
}

/** Flat-shaded prism for a marker: every footprint vertex placed on the ground, faces painted back to front. */
function drawSolid(ctx: CanvasRenderingContext2D, sc: Scene, m: SavedMarker, solid: Solid, distM: number, groundM: number, color: string, lightAzDeg: number) {
  const pin = worldStore.getState().pin;
  const toCam = bearingDeg(m, pin) * D2R;
  const eye = { e: distM * Math.sin(toCam), n: distM * Math.cos(toCam), u: sc.eyeM - groundM };
  const local = pinFrame(m);
  const pts = solid.vertices.map((v) => {
    const gp = local.fromEn(v.e, v.n);
    const dv = distanceM(pin, gp);
    if (dv < 1e-6) return null;
    return toPx(sc, bearingDeg(pin, gp), elevationAngleDeg(dv, groundM + v.u - sc.eyeM));
  });
  // Vertices projected well past the frame are still drawn; only a wholly off-screen face is dropped.
  const slack = Math.max(sc.frame.w, sc.frame.h) * 2;
  ctx.lineWidth = 1;
  for (const f of facesToward(solid, eye)) {
    const poly = f.v.map((i) => pts[i]);
    if (poly.some((q) => q == null)) continue;
    if (poly.every((q) => !inView(sc, q, slack))) continue;
    ctx.fillStyle = shaded(color, faceShade(f, lightAzDeg));
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const [i, q] of poly.entries()) {
      if (i === 0) ctx.moveTo(q!.x, q!.y);
      else ctx.lineTo(q!.x, q!.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.lineWidth = 1.5;
}
