import { AltitudeRef, type SavedModel } from '@core/model';

/** Changes exactly when the ground under a model must be read again. */
export function groundKey(m: Pick<SavedModel, 'anchor' | 'footprint'>): string | null {
  return m.anchor.altRef === AltitudeRef.Ground && m.footprint.length >= 3 ? m.footprint.flat().join(',') : null;
}

export interface GroundRefreshDeps {
  /** Lowest ground under the footprint; null when the DEM is unreadable. */
  resolve(footprint: [number, number][]): Promise<number | null>;
  current(id: string): SavedModel | undefined;
  apply(m: SavedModel, groundM: number): Promise<unknown>;
  delayMs: number;
}

/** Debounces ground reads per model, one in flight each; a read for a footprint that moved on is dropped. */
export function groundRefresher(deps: GroundRefreshDeps): (id: string) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Set<string>();
  const again = new Set<string>();
  const run = async (id: string): Promise<void> => {
    if (running.has(id)) {
      again.add(id);
      return;
    }
    const m = deps.current(id);
    const key = m && groundKey(m);
    if (!m || !key) return;
    running.add(id);
    try {
      const groundM = (await deps.resolve(m.footprint).catch(() => null)) ?? NaN;
      const cur = deps.current(id);
      if (cur && groundKey(cur) === key && !Object.is(cur.groundM, groundM)) await deps.apply(cur, groundM);
    } finally {
      running.delete(id);
      if (again.delete(id)) void run(id);
    }
  };
  return (id) => {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void run(id);
      }, deps.delayMs)
    );
  };
}
