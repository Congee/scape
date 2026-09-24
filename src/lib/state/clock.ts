import { worldStore } from './world';

function tick() {
  if (worldStore.getState().live) worldStore.setState({ time: Date.now() });
}

/** Ticks the simulated clock along with real time while `live` is on; a hidden page is not ticked. */
export function startClock(): () => void {
  let id: ReturnType<typeof setInterval> | undefined;
  const sync = () => {
    clearInterval(id);
    id = undefined;
    if (document.hidden) return;
    tick();
    id = setInterval(tick, 1000);
  };
  sync();
  document.addEventListener('visibilitychange', sync);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', sync);
  };
}
