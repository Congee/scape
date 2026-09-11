import { create } from 'zustand';
import type { DayCurve } from '@core/astro/dayCurve';
import type { DayEvent } from '@core/astro/dayEvents';
import { dayBounds } from '@core/time/localDay';
import type { AstroRequest, AstroResponse } from '@workers/astro.protocol';
import { settingsStore } from './settings';
import { worldStore } from './world';

export interface DayDataState {
  key: string;
  loading: boolean;
  dayStart: number;
  dayEnd: number;
  isoDate: string;
  events: DayEvent[];
  curve: DayCurve | null;
}

export const dayDataStore = create<DayDataState>()(() => ({
  key: '',
  loading: false,
  dayStart: 0,
  dayEnd: 0,
  isoDate: '',
  events: [],
  curve: null
}));

export const useDayData = dayDataStore;

const MIN_INTERVAL_MS = 120;

/** Recomputes the day's events and curves in a worker whenever (pin, day, tz, thresholds) change. */
export function startDayDataSync(): () => void {
  const worker = new Worker(new URL('../workers/astro.worker.ts', import.meta.url), { type: 'module' });
  let seq = 0;
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  worker.addEventListener('message', (e: MessageEvent<AstroResponse>) => {
    if (e.data.id !== seq) return;
    dayDataStore.setState({ loading: false, events: e.data.events, curve: e.data.curve });
  });

  const compute = () => {
    last = performance.now();
    const w = worldStore.getState();
    const s = settingsStore.getState();
    const b = dayBounds(new Date(w.time), w.tz);
    const key = [w.pin.lat.toFixed(5), w.pin.lng.toFixed(5), w.pinHeightM, w.tz, b.isoDate, s.goldenAltitude].join('|');
    if (key === dayDataStore.getState().key) return;
    seq++;
    const startMs = b.start.getTime();
    const endMs = b.end.getTime();
    dayDataStore.setState({ key, loading: true, dayStart: startMs, dayEnd: endMs, isoDate: b.isoDate });
    const req: AstroRequest = {
      id: seq,
      pin: w.pin,
      heightAboveGroundM: w.pinHeightM,
      startMs,
      endMs,
      goldenAltitude: s.goldenAltitude
    };
    worker.postMessage(req);
  };

  // Throttle with a trailing call so pin drags recompute smoothly but not per frame.
  const schedule = () => {
    clearTimeout(timer);
    const wait = Math.max(0, MIN_INTERVAL_MS - (performance.now() - last));
    timer = setTimeout(compute, wait);
  };

  compute();
  const unsubs = [worldStore.subscribe(schedule), settingsStore.subscribe(schedule)];
  return () => {
    for (const u of unsubs) u();
    clearTimeout(timer);
    worker.terminate();
  };
}
