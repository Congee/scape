import { worldStore } from './world';

/** Ticks the simulated clock along with real time while `live` is on. */
export function startClock(): () => void {
  const id = setInterval(() => {
    if (worldStore.getState().live) worldStore.setState({ time: Date.now() });
  }, 1000);
  return () => clearInterval(id);
}
