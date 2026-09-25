/** Chord-versus-frame test for sampled paths. */

import type { Rect } from './labelClash';

type Pt = { x: number; y: number };

/** Whether segment a–b touches the rect grown by `margin`; Liang–Barsky, so a chord crossing with both ends outside counts. */
export const segmentHitsRect = (a: Pt, b: Pt, rect: Rect, margin = 0) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - (rect.x - margin)],
    [dx, rect.x + rect.w + margin - a.x],
    [-dy, a.y - (rect.y - margin)],
    [dy, rect.y + rect.h + margin - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
};
