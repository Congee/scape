import { effectiveOptics, tcFactor } from '@core/optics/fov';
import { borderRects, type Rect } from '@core/viewfinder/frameFit';
import { buildingsStore } from '@state/buildings';
import { compositionStore } from '@state/composition';
import { settingsStore } from '@state/settings';
import { skyStore } from '@state/sky';
import { terrainStore } from '@state/terrain';
import { FONT_SANS } from '../inks';
import { haloText, type Scene } from './paint';

/** Frame border where the picture reaches past it, thirds grid and centre mark. */
export function drawFrame(ctx: CanvasRenderingContext2D, sc: Scene, bufferH: number, dpr: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgb(230,237,243)';
  for (const b of borderRects(sc.vp, bufferH, dpr)) ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.restore();
  ctx.lineWidth = 1;
  if (compositionStore.getState().showGrid) {
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
}

/** One line under the frame: the lens on the left, whatever the view is waiting on to the right. */
export function drawHud(ctx: CanvasRenderingContext2D, sc: Scene) {
  const c = compositionStore.getState();
  const s = settingsStore.getState();
  const t = terrainStore.getState();
  ctx.font = `11px ${FONT_SANS}`;
  ctx.textBaseline = 'top';
  const y = sc.frame.y + sc.frame.h + 6;
  const lens = `${effectiveOptics(c).focalMm} mm${c.teleconverters.length === 0 ? '' : ` · ${tcFactor(c.teleconverters)}×`} · ${sc.hfov.toFixed(1)}° × ${sc.vfov.toFixed(1)}°`;
  let status = '';
  if (!s.terrain) status = 'Elevation data is off (Settings): flat horizon';
  else if (t.busy.View) status = 'Sweeping terrain…';
  else if (!sc.view) status = 'Waiting for terrain…';
  else if (c.showBuildings && buildingsStore.getState().busy) status = 'Loading buildings…';
  else if (skyStore.getState().loading) status = 'Loading sky data…';
  else if (skyStore.getState().error) status = `Sky data: ${skyStore.getState().error}`;
  else if (t.view?.missing) status = `${t.view.missing} terrain tiles missing`;
  // Too narrow for both: the status is the one that changes, so it wins.
  const both = !status || ctx.measureText(lens).width + ctx.measureText(status).width + 12 <= sc.frame.w;
  // Below the frame lies picture when the area reaches past it vertically.
  const put = (text: string, x: number) => (sc.vp.padY > 0 ? haloText(ctx, text, x, y) : ctx.fillText(text, x, y));
  if (both) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(230,237,243,0.9)';
    put(lens, sc.frame.x);
  }
  if (status) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(230,237,243,0.7)';
    put(status, sc.frame.x + sc.frame.w);
  }
}

/** No GPU, no picture: the frame carries the reason rather than a blank canvas. */
export function drawGlError(ctx: CanvasRenderingContext2D, frame: Rect, message: string) {
  const { x, y, w, h } = frame;
  ctx.strokeStyle = 'rgba(230,237,243,0.9)';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  ctx.font = `13px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(230,237,243,0.9)';
  const lines: string[] = [];
  for (const word of message.split(' ')) {
    const last = lines.at(-1);
    if (last && ctx.measureText(`${last} ${word}`).width <= w - 24) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  for (const [i, line] of lines.entries()) ctx.fillText(line, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * 18);
}
