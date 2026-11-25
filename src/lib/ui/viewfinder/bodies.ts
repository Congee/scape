import { BODIES, bodyVisible, SkyBody } from '@core/astro/bodies';
import { moonInfo, moonTerminator, position, semidiameterDeg } from '@core/astro/positions';
import { discRadiusMm } from '@core/optics/projection';
import { flatHorizonDeg } from '@core/terrain/los';
import { columnAt } from '@core/terrain/view';
import { formatTime } from '@core/time/format';
import { hexRgba, OverlayFlag } from '@core/viewfinder/gl/overlayGl';
import { labelHitsDiscs, type Disc } from '@core/viewfinder/labelClash';
import { behindBuilding, inView, toPx } from '@core/viewfinder/place';
import { segmentHitsRect } from '@core/viewfinder/segmentRect';
import { compositionStore } from '@state/composition';
import { dayDataStore } from '@state/dayData';
import { settingsStore } from '@state/settings';
import { worldStore } from '@state/world';
import { FONT_SANS } from '../inks';
import { clipToArea, haloText, type Paint, type Scene } from './paint';

const BODY_COLOR: Record<SkyBody, string> = { Sun: '#f5a524', Moon: '#9ccbff', Gc: '#b48cff' };

export interface BodyLabel {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
}

/** Path occlusion per body; it does not depend on the aim, so a drag reuses it. */
export type PathMemo = Map<SkyBody, { occ: unknown; view: unknown; curve: unknown; h: Int8Array }>;

/** Sun, moon and Galactic Centre marks; their labels come back to be drawn over the picture. */
export function drawBodies(p: Paint, sc: Scene, picture: boolean): BodyLabel[] {
  const c = compositionStore.getState();
  const s = settingsStore.getState();
  const date = new Date(worldStore.getState().time);
  const labels: BodyLabel[] = [];
  for (const b of BODIES) {
    if (!bodyVisible(b, c, s)) continue;
    const l = drawBody(p, sc, b, date, picture);
    if (l) labels.push(l);
  }
  return labels;
}

function drawBody(p: Paint, sc: Scene, body: SkyBody, date: Date, picture: boolean): BodyLabel | null {
  const pos = position(body, date, sc.obs);
  const q = toPx(sc, pos.azimuth, pos.altitude);
  if (!inView(sc, q, 60)) return null;
  const { ctx } = p;
  const col = sc.view ? columnAt(sc.view, pos.azimuth) : -1;
  const skyline = col >= 0 && sc.view ? sc.view.skylineDeg[col] : flatHorizonDeg(sc.eyeAboveGroundM);
  const semi = semidiameterDeg(body, date, sc.obs);
  const hidden = pos.altitude + semi < skyline || behindBuilding(p.occ, pos.azimuth, pos.altitude, Infinity);
  const r = Math.max(3, discRadiusMm(sc.cam, semi) * sc.frame.pxPerMm);
  p.seen.bodies[body] = { az: pos.azimuth, alt: pos.altitude, x: q.x, y: q.y, r, hidden };
  // The picture pass draws the discs itself, clipped per pixel; only the label is left here.
  const inPicture = picture && body !== SkyBody.Gc;
  clipToArea(ctx, sc.area);
  ctx.globalAlpha = hidden ? 0.35 : 1;
  if (body === SkyBody.Gc) {
    ctx.strokeStyle = BODY_COLOR.Gc;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(q.x - 10, q.y);
    ctx.lineTo(q.x + 10, q.y);
    ctx.moveTo(q.x, q.y - 10);
    ctx.lineTo(q.x, q.y + 10);
    ctx.stroke();
  } else if (inPicture) {
    // Nothing to draw over the picture.
  } else if (body === SkyBody.Sun) {
    const g = ctx.createRadialGradient(q.x, q.y, r * 0.5, q.x, q.y, r * 4);
    g.addColorStop(0, 'rgba(255,220,120,0.55)');
    g.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const info = moonInfo(date);
    ctx.fillStyle = '#2b3442';
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Lit fraction as a lens shape; the bright limb faces the sun, i.e. west when waxing (northern view).
    const term = moonTerminator(info.illumination, info.waxing);
    ctx.fillStyle = '#e8eef5';
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, -Math.PI / 2, Math.PI / 2, term.litSide < 0);
    ctx.ellipse(q.x, q.y, Math.max(0.01, term.rx * r), r, 0, Math.PI / 2, -Math.PI / 2, term.gibbous === (term.litSide < 0));
    ctx.fill();
  }
  ctx.restore();
  return { x: q.x, y: q.y + r + 4, text: body === SkyBody.Gc ? 'Galactic Centre' : body === SkyBody.Sun ? 'Sun' : 'Moon', color: BODY_COLOR[body], alpha: hidden ? 0.35 : 1 };
}

/** Body names, drawn over the picture so a tower never swallows a label. */
export function drawBodyLabels(p: Paint, sc: Scene, labels: BodyLabel[]) {
  if (labels.length === 0) return;
  const { ctx } = p;
  clipToArea(ctx, sc.area);
  ctx.font = `11px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const l of labels) {
    ctx.globalAlpha = l.alpha;
    ctx.fillStyle = l.color;
    haloText(ctx, l.text, l.x, l.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** The day's sun, moon and GC paths with hour marks, for the bodies shown. */
export function drawPaths(p: Paint, sc: Scene, memo: PathMemo) {
  const c = compositionStore.getState();
  const s = settingsStore.getState();
  clipToArea(p.ctx, sc.area);
  if (c.showPaths) {
    for (const b of BODIES) {
      if (!bodyVisible(b, c, s)) continue;
      drawPath(p, sc, b, BODY_COLOR[b], memo);
    }
  }
  p.ctx.restore();
}

function drawPath(p: Paint, sc: Scene, body: SkyBody, color: string, memo: PathMemo) {
  const { curve } = dayDataStore.getState();
  if (!curve) return;
  const { ctx } = p;
  const alts = curve.altitude[body];
  const azs = curve.azimuth[body];
  const world = worldStore.getState();
  const hour12 = settingsStore.getState().hour12;
  const line = hexRgba(color, 0.9);
  let prev: { x: number; y: number } | null = null;
  let prevSky = false;
  // The picture draws these under the overlay; ghosted ones behind geometry still show.
  const discs: Disc[] = [SkyBody.Sun, SkyBody.Moon].flatMap((b) => p.seen.bodies[b] ?? []);
  ctx.font = `10px ${FONT_SANS}`;
  const pxs = Array.from({ length: curve.n }, (_, i) => toPx(sc, azs[i], alts[i]));
  const ins = pxs.map((q) => inView(sc, q, 40));
  // Occlusion does not depend on the aim, so a drag reuses it until the path or occluders change.
  let m = memo.get(body);
  if (!m || m.occ !== p.occ || m.view !== sc.view || m.curve !== curve) memo.set(body, (m = { occ: p.occ, view: sc.view, curve, h: new Int8Array(curve.n) }));
  const h = m.h;
  for (let i = 0; i < curve.n; i++) {
    const q = pxs[i];
    const inside = ins[i];
    const col = sc.view ? columnAt(sc.view, azs[i]) : -1;
    const sky = col >= 0 && alts[i] < sc.view!.skylineDeg[col];
    // Segments are clipped per pixel in the picture pass; the skyline is only known here.
    if (q && prev && segmentHitsRect(prev, q, sc.area, 40)) {
      p.marks.segment(prev.x, prev.y, q.x, q.y, 1.5, sky || prevSky ? OverlayFlag.Hidden : 0, 0.35, line);
      if (p.probe) {
        const a = behindBuilding(p.occ, azs[i - 1], alts[i - 1], Infinity);
        const b = behindBuilding(p.occ, azs[i], alts[i], Infinity);
        p.probe.push(1, prev.x, prev.y, q.x, q.y, sky || prevSky ? 2 : a && b ? 1 : a || b ? 3 : 0);
      }
    }
    const t = curve.startMs + i * curve.stepMs;
    if (inside && q && new Date(t).getUTCMinutes() === 0 && t % 3_600_000 === (curve.startMs % 3_600_000 + (i * curve.stepMs)) % 3_600_000) {
      const hidden = sky || (h[i] !== 0 ? h[i] > 0 : (h[i] = behindBuilding(p.occ, azs[i], alts[i], Infinity) ? 1 : -1) > 0);
      const label = formatTime(t, world.tz, hour12).replace(':00', '');
      ctx.globalAlpha = hidden ? 0.5 : 0.95;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      p.probe?.push(2, q.x, q.y, 0, 0, 0);
      const box = { x: q.x + 4, y: q.y - 13, w: ctx.measureText(label).width, h: 10 };
      // Margin is the halo's half stroke.
      const skipped = labelHitsDiscs(box, discs, 1.5);
      p.seen.pathLabels.push({ body, text: label, ...box, skipped });
      if (!skipped) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        haloText(ctx, label, box.x, q.y - 3);
      }
    }
    prev = q;
    prevSky = sky;
  }
  ctx.globalAlpha = 1;
}
