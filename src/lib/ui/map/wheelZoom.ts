// oxlint-disable no-underscore-dangle -- MapLibre's scrollZoom internals
import type { Map as MaplibreMap } from 'maplibre-gl';

/** MapLibre's mouse-wheel tick on macOS, which it always treats as a wheel. */
const WHEEL_TICK = 4.000244140625;
/** MapLibre's gap that starts a new wheel gesture, ms. */
const GESTURE_GAP_MS = 400;
/** A first delta this big may be a mouse notch (Windows sends 100 px, scaled by the display); MapLibre decides those. */
const NOTCH_PX = 50;

type ScrollZoomPrivate = {
  wheel(e: WheelEvent): void;
  _onTimeout: unknown;
  _delta: number;
  _type?: 'wheel' | 'trackpad' | null;
  _lastWheelEventTime?: number;
};

/** Whether a gesture's first wheel event is from a trackpad (pinch or two-finger scroll) rather than a mouse wheel. */
export function trackpadStart(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): boolean {
  const v = e.deltaY;
  if (e.deltaMode !== 0 || !v || v % WHEEL_TICK === 0) return false;
  return Math.abs(v) < NOTCH_PX;
}

/**
 * Starts trackpad gestures on MapLibre's trackpad path at once. Left alone, a first delta of 4 px or more waits 40 ms,
 * then |Δt·delta| ≥ 200 picks the mouse path, which eases every event over 200 ms at a quarter of the rate: fast
 * swipes at frame-paced delivery land there and zoom late and short.
 */
export function installTrackpadWheel(map: MaplibreMap): () => void {
  const sz = map.scrollZoom as unknown as ScrollZoomPrivate;
  if (typeof sz.wheel !== 'function' || typeof sz._onTimeout !== 'function' || typeof sz._delta !== 'number') {
    throw new Error('[scape] MapLibre scrollZoom internals changed; update wheelZoom.ts');
  }
  const wheel = sz.wheel;
  sz.wheel = function (this: ScrollZoomPrivate, e: WheelEvent) {
    const t = performance.now();
    if (t - (this._lastWheelEventTime ?? 0) > GESTURE_GAP_MS && trackpadStart(e)) {
      // Past MapLibre's new-gesture guess: the delta applies on this event.
      this._type = 'trackpad';
      this._lastWheelEventTime = t;
    }
    wheel.call(this, e);
  };
  return () => {
    sz.wheel = wheel;
  };
}
