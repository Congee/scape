/** A touch held still this long opens the map menu. */
export const LONG_PRESS_MS = 500;
/** Finger travel that turns a press into a pan. */
export const LONG_PRESS_SLOP_PX = 8;

export interface Pt {
  x: number;
  y: number;
}

/** One-finger long-press, fed touch points; the caller owns the timer and calls `elapse` when it fires. */
export class LongPress {
  private start: Pt | null = null;
  /** Set once it fired, until every finger lifts. */
  private fired = false;

  /** True when a press starts and the caller should arm the timer. */
  down(touches: readonly Pt[]): boolean {
    if (touches.length !== 1 || this.fired) {
      this.start = null;
      return false;
    }
    this.start = { ...touches[0] };
    return true;
  }

  /** True when the move cancelled a pending press. */
  move(touches: readonly Pt[]): boolean {
    if (!this.start) return false;
    const t = touches[0];
    if (touches.length === 1 && Math.hypot(t.x - this.start.x, t.y - this.start.y) <= LONG_PRESS_SLOP_PX) return false;
    this.start = null;
    return true;
  }

  /** The press point when the timer fired on a press still held. */
  elapse(): Pt | null {
    const p = this.start;
    this.start = null;
    if (p) this.fired = true;
    return p;
  }

  /** Returns whether this touch sequence fired, so the caller can swallow the tap that follows. */
  up(remaining: number): boolean {
    this.start = null;
    const fired = this.fired;
    if (remaining === 0) this.fired = false;
    return fired;
  }

  get pending(): boolean {
    return this.start !== null;
  }
}
