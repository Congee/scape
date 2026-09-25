import { useEffect } from 'react';
import { create } from 'zustand';
import { worldStore } from './world';

interface ClockState {
  /** Views showing live seconds; above zero the clock ticks each second, else each minute. */
  secondsWanted: number;
}

export const useClock = create<ClockState>(() => ({ secondsWanted: 0 }));
export const clockStore = useClock;

/** Asks for a per-second live tick while `on`. */
export function useSecondsTick(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    clockStore.setState((s) => ({ secondsWanted: s.secondsWanted + 1 }));
    return () => clockStore.setState((s) => ({ secondsWanted: s.secondsWanted - 1 }));
  }, [on]);
}

/** Milliseconds from `now` to just past the next whole second or minute, so each tick lands on a new digit. */
export function nextTickDelay(now: number, seconds: boolean): number {
  const unit = seconds ? 1000 : 60_000;
  return unit - (now % unit) + 5;
}

/** Ticks the simulated clock along with real time while `live` is on; a hidden page is not ticked. */
export function startClock(): () => void {
  let id: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(id);
    id = undefined;
    if (document.hidden || !worldStore.getState().live) return;
    id = setTimeout(tick, nextTickDelay(Date.now(), clockStore.getState().secondsWanted > 0));
  };
  const tick = () => {
    if (worldStore.getState().live) worldStore.setState({ time: Date.now() });
    schedule();
  };
  const sync = () => (document.hidden ? schedule() : tick());
  sync();
  document.addEventListener('visibilitychange', sync);
  const offLive = worldStore.subscribe((s, p) => s.live !== p.live && schedule());
  const offWanted = clockStore.subscribe((s, p) => (s.secondsWanted > 0) !== (p.secondsWanted > 0) && tick());
  return () => {
    clearTimeout(id);
    offLive();
    offWanted();
    document.removeEventListener('visibilitychange', sync);
  };
}
