import { addProtocol } from 'maplibre-gl';
import { encodeRgbaPng } from '@core/terrain/pngEncode';
import { encodeTerrarium } from '@core/terrain/terrarium';
import { fetchTile, hasValidPost, overzoom } from './demTiles';

let registered = false;

/** Registers `scape-dem://{z}/{x}/{y}` once: downloaded regions first, network otherwise. */
export function ensureDemProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol('scape-dem', async (params, abortController) => {
    const m = /scape-dem:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`Invalid terrain tile URL ${params.url}`);
    const c = { z: +m[1], x: +m[2], y: +m[3] };
    const got = await fetchTile(c, abortController.signal);
    // A tile with no valid post at all falls back like a 404 rather than drawing a -32768 m pit.
    if (got && (await hasValidPost(got.data))) return { data: new Uint8Array(got.data), cacheControl: got.cacheControl, expires: got.expires };
    const tile = await overzoom(c);
    return { data: encodeRgbaPng(encodeTerrarium(tile.elev, tile.size), tile.size, tile.size) };
  });
}
