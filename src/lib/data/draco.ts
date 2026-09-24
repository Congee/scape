/** draco3d, loaded by dynamic import only when a tile needs it, so it ships to CH/JP viewers alone. */

import createDecoderModule from 'draco3d/draco_decoder_nodejs.js';
import wasmUrl from 'draco3d/draco_decoder.wasm?url';
import { dracoDecoder } from '@core/model/draco';
import type { DracoDecoder } from '@core/model/gltf';

export async function loadDraco(): Promise<DracoDecoder> {
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`Draco decoder ${res.status}`);
  return dracoDecoder(await createDecoderModule({ wasmBinary: await res.arrayBuffer() }));
}
