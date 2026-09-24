/// <reference lib="webworker" />
import { encodeTerrariumPadded } from '@core/terrain/terrarium';
import { loadDemTile } from '@data/demTiles';
import type { DemRequest, DemResponse } from './dem.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const pending = new Map<number, AbortController>();

scope.addEventListener('message', async (e: MessageEvent<DemRequest>) => {
  const req = e.data;
  if ('cancel' in req) {
    pending.get(req.id)?.abort();
    pending.delete(req.id);
    return;
  }
  const abort = new AbortController();
  pending.set(req.id, abort);
  try {
    const dem = await loadDemTile(req.tile, abort.signal);
    const rgba = encodeTerrariumPadded(dem.elev, dem.size);
    const res: DemResponse = { id: req.id, size: dem.size, rgba, cacheControl: dem.cacheControl, expires: dem.expires };
    scope.postMessage(res, [rgba.buffer]);
  } catch (err) {
    if (!abort.signal.aborted) scope.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) } satisfies DemResponse);
  } finally {
    pending.delete(req.id);
  }
});
