import { addProtocol } from 'maplibre-gl';
import { localTerrain } from './localTiles';
import { terrainTileUrl } from './terrainTiles';

let registered = false;

/** Registers `scape-dem://{z}/{x}/{y}` once: downloaded regions first, network otherwise. */
export function ensureDemProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol('scape-dem', async (params, abortController) => {
    const m = /scape-dem:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`Invalid terrain tile URL ${params.url}`);
    const [z, x, y] = [+m[1], +m[2], +m[3]];
    const local = await localTerrain.tile(z, x, y);
    if (local) return { data: new Uint8Array(local) };
    const res = await fetch(terrainTileUrl(z, x, y), { signal: abortController.signal });
    if (!res.ok) throw new Error(`Terrain tile ${z}/${x}/${y}: HTTP ${res.status}`);
    return { data: new Uint8Array(await res.arrayBuffer()) };
  });
}
