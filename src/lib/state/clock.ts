import { worldStore } from './world';

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
    id = setTimeout(tick, nextTickDelay(Date.now(), false));
  };
  const tick = () => {
    if (worldStore.getState().live) worldStore.setState({ time: Date.now() });
    schedule();
  };
  const sync = () => (document.hidden ? schedule() : tick());
  sync();
  document.addEventListener('visibilitychange', sync);
  const offLive = worldStore.subscribe((s, p) => s.live !== p.live && schedule());
  return () => {
    clearTimeout(id);
    offLive();
    document.removeEventListener('visibilitychange', sync);
  };
}
