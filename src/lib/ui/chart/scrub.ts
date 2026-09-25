export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

/** The instant at `x` on a chart `w` units wide spanning [startMs, endMs), on a whole minute and inside the span. */
export function timeAtX(x: number, w: number, startMs: number, endMs: number): number {
  if (!(w > 0) || !(endMs > startMs)) return startMs;
  const t = startMs + (x / w) * (endMs - startMs);
  return clampTime(Math.round(t / MINUTE_MS) * MINUTE_MS, startMs, endMs);
}

/** The x of `ms` on a chart `w` units wide spanning [startMs, endMs). */
export const xAtTime = (ms: number, w: number, startMs: number, endMs: number) => (endMs > startMs ? ((ms - startMs) / (endMs - startMs)) * w : 0);

/** Clamps into [startMs, endMs); the end instant belongs to the next day. */
export function clampTime(ms: number, startMs: number, endMs: number): number {
  const last = Math.max(startMs, endMs - MINUTE_MS);
  return Math.min(last, Math.max(startMs, ms));
}

/** The time step an arrow key makes: `step`, or `fine` with Shift; 0 for any other key. */
export function keyStep(key: string, shift: boolean, step = HOUR_MS, fine = 10 * MINUTE_MS): number {
  const d = shift ? fine : step;
  return key === 'ArrowRight' ? d : key === 'ArrowLeft' ? -d : 0;
}

/** CSS px a finger must move sideways before a touch scrubs. */
export const TOUCH_SLOP_PX = 6;

export const TouchGesture = {
  /** Still under the slop: a release here is a tap. */
  Pending: 'pending',
  Scrub: 'scrub',
  /** Moved vertically first: the page scrolls, the time stays. */
  Scroll: 'scroll'
} as const;
export type TouchGesture = (typeof TouchGesture)[keyof typeof TouchGesture];

/** What a touch that has moved (dx, dy) px since it went down is doing. */
export function touchGesture(dx: number, dy: number, slop = TOUCH_SLOP_PX): TouchGesture {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= slop && ax > ay) return TouchGesture.Scrub;
  if (ay >= slop) return TouchGesture.Scroll;
  return TouchGesture.Pending;
}

/** CSS px either side of the time line where a mouse can grab it. */
export const GRAB_PX = 6;

/** Whether a pointer at client x `px` is on the time line at `lineX`; null when no line is drawn. */
export const nearLine = (px: number, lineX: number | null, slop = GRAB_PX) => lineX !== null && Math.abs(px - lineX) <= slop;
