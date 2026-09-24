import { create } from 'zustand';
import { sequenceTime } from '@core/optics/timelapse';
import { worldStore } from './world';

/** Plays a time-lapse by stepping the shared clock one interval per frame. */
export interface TimelapseSim {
  playing: boolean;
  /** Clock at the first shot; null before the first play. */
  startMs: number | null;
  k: number;
  play(intervalS: number, shots: number, fps: number): void;
  pause(): void;
  reset(): void;
}

let timer: ReturnType<typeof setInterval> | null = null;
const stop = () => {
  if (timer !== null) clearInterval(timer);
  timer = null;
};

export const timelapseStore = create<TimelapseSim>()((set, get) => ({
  playing: false,
  startMs: null,
  k: 0,
  play(intervalS, shots, fps) {
    stop();
    const startMs = get().startMs ?? worldStore.getState().time;
    set({ playing: true, startMs });
    // Browsers clamp faster timers anyway; 30 Hz keeps the viewfinder redraws affordable.
    timer = setInterval(() => {
      const k = get().k + 1;
      set({ k });
      worldStore.getState().setTime(sequenceTime(startMs, intervalS, shots, k));
    }, Math.max(1000 / fps, 33));
  },
  pause() {
    stop();
    set({ playing: false });
  },
  reset() {
    stop();
    const { startMs } = get();
    if (startMs !== null) worldStore.getState().setTime(startMs);
    set({ playing: false, startMs: null, k: 0 });
  }
}));

export const useTimelapse = timelapseStore;
