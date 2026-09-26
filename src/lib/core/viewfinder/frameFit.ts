/** The sensor frame inside the viewfinder's picture area, which the picture fills beyond the frame. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameRect extends Rect {
  pxPerMm: number;
}

/** CSS px: the frame with the sensor's aspect, centred in the area, which keeps a readout line below. */
export interface FrameFit {
  frame: FrameRect;
  area: Rect;
}

/** Drawing-buffer px, rows counted from the bottom as GL does. */
export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FitViewports {
  frame: Viewport;
  /** Centred on the frame's viewport, so the frame's own pixels project exactly as they would alone. */
  area: Viewport;
  /** Device px the area reaches past the frame on each side. */
  padX: number;
  padY: number;
}

export function fitFrame(canvasW: number, canvasH: number, frameWmm: number, frameHmm: number): FrameFit {
  const availW = Math.max(40, canvasW - 16);
  const availH = Math.max(40, canvasH - 30);
  const scale = Math.min(availW / frameWmm, availH / frameHmm);
  const w = frameWmm * scale;
  const h = frameHmm * scale;
  return { frame: { x: (canvasW - w) / 2, y: 8 + (availH - h) / 2, w, h, pxPerMm: scale }, area: { x: (canvasW - availW) / 2, y: 8, w: availW, h: availH } };
}

// Under a pixel of slack is rounding, not room: an exact fit gets no extension and no border.
const pad = (d: number) => (d < 1 ? 0 : Math.round(d));

export function fitViewports(fit: FrameFit, bufferH: number, dpr: number): FitViewports {
  const { frame, area } = fit;
  const x = Math.round(frame.x * dpr);
  const w = Math.max(2, Math.round(frame.w * dpr));
  const h = Math.max(2, Math.round(frame.h * dpr));
  const top = Math.round(frame.y * dpr);
  const y = Math.max(0, bufferH - top - h);
  const padX = pad(x - area.x * dpr);
  const padY = pad(top - area.y * dpr);
  return { frame: { x, y, w, h }, area: { x: x - padX, y: y - padY, w: w + 2 * padX, h: h + 2 * padY }, padX, padY };
}

/** Border bars just outside the frame, drawing-buffer px from the top left; only on sides the picture extends past. */
export function borderRects(vp: FitViewports, bufferH: number, dpr: number): Rect[] {
  const b = Math.max(1, Math.round(dpr));
  const { x, w, h } = vp.frame;
  const top = bufferH - vp.frame.y - h;
  const out: Rect[] = [];
  if (vp.padY > 0) out.push({ x, y: top - b, w, h: b }, { x, y: top + h, w, h: b });
  if (vp.padX > 0) {
    // Corners go with the vertical bars when both are drawn.
    const y0 = vp.padY > 0 ? top - b : top;
    const y1 = vp.padY > 0 ? top + h + b : top + h;
    out.push({ x: x - b, y: y0, w: b, h: y1 - y0 }, { x: x + w, y: y0, w: b, h: y1 - y0 });
  }
  return out;
}
