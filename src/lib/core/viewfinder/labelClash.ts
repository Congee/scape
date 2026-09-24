/** Overlay text versus the sun and moon discs the picture draws under it. */

export type Rect = { x: number; y: number; w: number; h: number };
export type Disc = { x: number; y: number; r: number };

/** Whether a rect, grown by `margin` on every side, touches a circle. */
export const rectHitsDisc = (rect: Rect, disc: Disc, margin = 0) => {
  const x0 = rect.x - margin;
  const y0 = rect.y - margin;
  const dx = disc.x - Math.min(Math.max(disc.x, x0), rect.x + rect.w + margin);
  const dy = disc.y - Math.min(Math.max(disc.y, y0), rect.y + rect.h + margin);
  return dx * dx + dy * dy <= disc.r * disc.r;
};

/** Whether a label would cover any of this frame's discs; checked per draw, so it comes back once they move. */
export const labelHitsDiscs = (rect: Rect, discs: readonly Disc[], margin = 0) => discs.some((d) => rectHitsDisc(rect, d, margin));
