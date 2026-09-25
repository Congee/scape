import type { TileCoord } from '@core/terrain/tiles';
import type { DemEncoded, DemFormat, DemPixels, DemRequest, DemResponse } from '@workers/dem.protocol';

type DemReply<F extends DemFormat> = Extract<DemPixels | DemEncoded, { format: F }>;

let worker: Worker | undefined;
let nextId = 0;
const waiters = new Map<number, { resolve: (r: DemPixels | DemEncoded) => void; reject: (e: Error) => void }>();

/** One tile through the DEM worker: fetch, decode and repair or validity check stay off the main thread. */
export function requestDem<F extends DemFormat>(tile: TileCoord, format: F, signal: AbortSignal): Promise<DemReply<F>> {
  if (!worker) {
    worker = new Worker(new URL('../workers/dem.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<DemResponse>) => {
      const res = e.data;
      const waiter = waiters.get(res.id);
      waiters.delete(res.id);
      if ('error' in res) waiter?.reject(new Error(res.error));
      else waiter?.resolve(res);
    });
  }
  const w = worker;
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve: resolve as (r: DemPixels | DemEncoded) => void, reject });
    signal.addEventListener('abort', () => {
      if (!waiters.delete(id)) return;
      w.postMessage({ id, cancel: true } satisfies DemRequest);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
    w.postMessage({ id, tile, format } satisfies DemRequest);
  });
}
