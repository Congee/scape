import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { worldStore } from '@state/world';
import { clampTime, HOUR_MS, keyStep, MINUTE_MS, nearLine, timeAtX, TouchGesture, touchGesture, xAtTime } from './scrub';

interface ScrubOptions {
  startMs: number;
  endMs: number;
  /** viewBox width. */
  w: number;
  /** Arrow-key step, and with Shift. */
  step?: number;
  fine?: number;
}

const setTime = (t: number) => worldStore.getState().setTime(t);

/** Chart x in viewBox units, so padding and aspect ratio need no bookkeeping. */
function viewX(svg: SVGSVGElement, clientX: number, clientY: number): number {
  const m = svg.getScreenCTM();
  return m ? new DOMPoint(clientX, clientY).matrixTransform(m.inverse()).x : 0;
}

/** Client x of the drawn time line, or null. */
function lineX(svg: SVGSVGElement): number | null {
  const r = svg.querySelector('.scrub-cursor .now')?.getBoundingClientRect();
  return r ? r.left + r.width / 2 : null;
}

/** Shows the grab cursor via `data-grab`, set imperatively so a hover never re-renders. */
function setGrab(svg: SVGSVGElement, on: boolean) {
  if (on !== svg.hasAttribute('data-grab')) svg.toggleAttribute('data-grab', on);
}

const hover = (e: PointerEvent<SVGSVGElement>) => setGrab(e.currentTarget, nearLine(e.clientX, lineX(e.currentTarget)));

/** SVG props that make a time-axis chart scrub the clock: press or drag sets the time at x, arrows step it. An element with `data-t` snaps a press to its time. A touch sets the time only on a tap or a sideways drag, so a vertical scroll never does. */
export function useTimeScrub({ startMs, endMs, w, step = HOUR_MS, fine = 10 * MINUTE_MS }: ScrubOptions) {
  const at = (e: PointerEvent<SVGSVGElement>) => timeAtX(viewX(e.currentTarget, e.clientX, e.clientY), w, startMs, endMs);
  const snapAt = (e: PointerEvent<SVGSVGElement>) => {
    const snap = (e.target as Element).closest('[data-t]')?.getAttribute('data-t');
    return snap ? Number(snap) : at(e);
  };
  const touch = useRef<{ id: number; x: number; y: number; gesture: TouchGesture } | null>(null);
  return {
    tabIndex: 0,
    'data-scrub': '',
    onPointerDown(e: PointerEvent<SVGSVGElement>) {
      if (e.button !== 0) return;
      if (e.pointerType === 'touch') {
        touch.current = { id: e.pointerId, x: e.clientX, y: e.clientY, gesture: TouchGesture.Pending };
        return;
      }
      // No preventDefault: the native press focuses the chart for the arrow keys without a focus ring.
      e.currentTarget.setPointerCapture(e.pointerId);
      setGrab(e.currentTarget, true);
      setTime(snapAt(e));
    },
    onPointerMove(e: PointerEvent<SVGSVGElement>) {
      const t = touch.current;
      if (t && t.id === e.pointerId) {
        if (t.gesture === TouchGesture.Pending) {
          t.gesture = touchGesture(e.clientX - t.x, e.clientY - t.y);
          if (t.gesture === TouchGesture.Scrub) e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (t.gesture === TouchGesture.Scrub) setTime(at(e));
        return;
      }
      if (e.currentTarget.hasPointerCapture(e.pointerId)) setTime(at(e));
      else if (e.pointerType === 'mouse' || e.pointerType === 'pen') hover(e);
    },
    onPointerUp(e: PointerEvent<SVGSVGElement>) {
      const t = touch.current;
      if (!t || t.id !== e.pointerId) {
        if (e.pointerType !== 'touch') hover(e);
        return;
      }
      touch.current = null;
      if (touchGesture(e.clientX - t.x, e.clientY - t.y) === TouchGesture.Pending && t.gesture === TouchGesture.Pending) setTime(snapAt(e));
    },
    onPointerLeave(e: PointerEvent<SVGSVGElement>) {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) setGrab(e.currentTarget, false);
    },
    onPointerCancel(e: PointerEvent<SVGSVGElement>) {
      setGrab(e.currentTarget, false);
      if (touch.current?.id === e.pointerId) touch.current = null;
    },
    onKeyDown(e: KeyboardEvent<SVGSVGElement>) {
      const d = keyStep(e.key, e.shiftKey, step, fine);
      if (!d) return;
      setTime(clampTime(worldStore.getState().time + d, startMs, endMs));
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
