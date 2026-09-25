import { addProtocol } from 'maplibre-gl';
import { DemFormat } from '@workers/dem.protocol';
import { requestDem } from './demWorker';

let registered = false;

/** Registers `scape-dem://{z}/{x}/{y}` once: downloaded regions first, network otherwise. */
export function ensureDemProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol('scape-dem', demTileHandler);
}

/** MapLibre's request for one `scape-dem://` tile. */
export async function demTileHandler(params: { url: string }, abortController: AbortController): Promise<{ data: Uint8Array; cacheControl?: string; expires?: string }> {
  const m = /scape-dem:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
  if (!m) throw new Error(`Invalid terrain tile URL ${params.url}`);
  const c = { z: +m[1], x: +m[2], y: +m[3] };
  // The validity decode and any rebuild from an ancestor run in the DEM worker.
  const { data, cacheControl, expires } = await requestDem(c, DemFormat.Encoded, abortController.signal);
  return { data: new Uint8Array(data), cacheControl, expires };
}
