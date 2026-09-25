import type { KeyboardEvent, PointerEvent } from 'react';
import { worldStore } from '@state/world';
import { clampTime, HOUR_MS, keyStep, MINUTE_MS, timeAtX, xAtTime } from './scrub';

interface ScrubOptions {
  startMs: number;
  endMs: number;
  /** viewBox width. */
  w: number;
  /** Arrow-key step, and with Shift. */
  step?: number;
  fine?: number;
}

/** Chart x in viewBox units, so padding and aspect ratio need no bookkeeping. */
function viewX(svg: SVGSVGElement, clientX: number, clientY: number): number {
  const m = svg.getScreenCTM();
  return m ? new DOMPoint(clientX, clientY).matrixTransform(m.inverse()).x : 0;
}

/** SVG props that make a time-axis chart scrub the clock: press or drag sets the time at x, arrows step it. An element with `data-t` snaps a press to its time. */
export function useTimeScrub({ startMs, endMs, w, step = HOUR_MS, fine = 10 * MINUTE_MS }: ScrubOptions) {
  const at = (e: PointerEvent<SVGSVGElement>) => timeAtX(viewX(e.currentTarget, e.clientX, e.clientY), w, startMs, endMs);
  return {
    tabIndex: 0,
    'data-scrub': '',
    onPointerDown(e: PointerEvent<SVGSVGElement>) {
      if (e.button !== 0) return;
      // No preventDefault: the native press focuses the chart for the arrow keys without a focus ring.
      e.currentTarget.setPointerCapture(e.pointerId);
      const snap = (e.target as Element).closest('[data-t]')?.getAttribute('data-t');
      worldStore.getState().setTime(snap ? Number(snap) : at(e));
    },
    onPointerMove(e: PointerEvent<SVGSVGElement>) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) worldStore.getState().setTime(at(e));
    },
    onKeyDown(e: KeyboardEvent<SVGSVGElement>) {
      const d = keyStep(e.key, e.shiftKey, step, fine);
      if (!d) return;
      worldStore.getState().setTime(clampTime(worldStore.getState().time + d, startMs, endMs));
      e.preventDefault();
    }
  };
}

/** The draggable time cursor: a line with a knob on top; non-scaling strokes keep it crisp under a stretched viewBox. */
export function ScrubCursor({ time, startMs, endMs, w, h }: { time: number; startMs: number; endMs: number; w: number; h: number }) {
  if (time < startMs || time >= endMs) return null;
  const x = xAtTime(time, w, startMs, endMs);
  return (
    <g className="scrub-cursor" aria-hidden="true">
      <line className="now" x1={x} x2={x} y1={0} y2={h} vectorEffect="non-scaling-stroke" />
      <line className="knob" x1={x} x2={x} y1={3} y2={Math.min(h, 10)} vectorEffect="non-scaling-stroke" />
    </g>
  );
}
