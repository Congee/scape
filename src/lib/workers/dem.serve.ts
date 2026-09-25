import { encodeTerrariumPadded } from '@core/terrain/terrarium';
import { loadDemBytes, loadDemTile } from '@data/demTiles';
import { DemFormat, type DemRequest, type DemResponse } from './dem.protocol';

/** The DEM worker's request loop, apart from its global scope so tests can drive it. */
export function demServer(post: (res: DemResponse, transfer: Transferable[]) => void): (req: DemRequest) => Promise<void> {
  const pending = new Map<number, AbortController>();
  return async (req) => {
    if ('cancel' in req) {
      pending.get(req.id)?.abort();
      pending.delete(req.id);
      return;
    }
    const abort = new AbortController();
    pending.set(req.id, abort);
    try {
      if (req.format === DemFormat.Encoded) {
        const got = await loadDemBytes(req.tile, abort.signal);
        post({ id: req.id, format: DemFormat.Encoded, ...got }, [got.data]);
      } else {
        const dem = await loadDemTile(req.tile, abort.signal);
        const rgba = encodeTerrariumPadded(dem.elev, dem.size);
        post({ id: req.id, format: DemFormat.Pixels, size: dem.size, rgba, cacheControl: dem.cacheControl, expires: dem.expires }, [rgba.buffer]);
      }
    } catch (err) {
      if (!abort.signal.aborted) post({ id: req.id, error: err instanceof Error ? err.message : String(err) }, []);
    } finally {
      pending.delete(req.id);
    }
  };
}
