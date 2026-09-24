/** Placing a reference photo over the viewfinder frame by its field of view. */

/** The 35 mm frame's diagonal, which "35 mm-equivalent" focal lengths are defined against. */
export const FULL_FRAME_DIAG_MM = Math.hypot(36, 24);

export interface PhotoPlacement {
  /** Pixels, for the photo's own aspect. */
  w: number;
  h: number;
  /** 35 mm-equivalent focal length from Exif; null follows the lens. */
  focal35: number | null;
  /** Offset of the photo centre, in photo widths; y is up. */
  dx: number;
  dy: number;
  rotDeg: number;
}

export interface PhotoBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotDeg: number;
}

/** tan of half the photo's horizontal field of view for a 35 mm-equivalent focal length. */
export function photoHalfTan(focal35: number, w: number, h: number): number {
  return (FULL_FRAME_DIAG_MM * w) / Math.hypot(w, h) / (2 * focal35);
}

/** Horizontal field of view, degrees. */
export function photoHfovDeg(focal35: number, w: number, h: number): number {
  return (2 * Math.atan(photoHalfTan(focal35, w, h)) * 180) / Math.PI;
}

/**
 * The photo's box in frame pixels. The viewfinder is rectilinear, so an angular width maps to
 * `2 tan(h/2) × focal` on the sensor; without Exif the photo spans the frame.
 */
export function fitPhoto(frame: { x: number; y: number; w: number; h: number; pxPerMm: number }, focalMm: number, p: PhotoPlacement): PhotoBox {
  const w = p.focal35 ? 2 * photoHalfTan(p.focal35, p.w, p.h) * focalMm * frame.pxPerMm : frame.w;
  const h = (w * p.h) / p.w;
  return { cx: frame.x + frame.w / 2 + p.dx * w, cy: frame.y + frame.h / 2 - p.dy * w, w, h, rotDeg: p.rotDeg };
}
