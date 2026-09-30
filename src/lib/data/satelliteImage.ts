/** Decoding and cutting satellite tiles. Worker-safe. */

import { clearFill, fillMask, maskTile, type NativeTile, needsFillMask, noDataShare, type SatSource, sniffImage } from '@core/tiles/satellite';

export const SAT_PX = 256;
/** Coarse masks kept: a z11 tile spans 64 z17 tiles. */
const MASKS_MAX = 32;

let canvas: OffscreenCanvas | null = null;

function ctx(): OffscreenCanvasRenderingContext2D {
  canvas ??= new OffscreenCanvas(SAT_PX, SAT_PX);
  return canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
}

/** RGBA of a 256 px bitmap. */
export function pixels(bmp: ImageBitmap): Uint8ClampedArray {
  const c = ctx();
  c.clearRect(0, 0, SAT_PX, SAT_PX);
  c.drawImage(bmp, 0, 0, SAT_PX, SAT_PX);
  return c.getImageData(0, 0, SAT_PX, SAT_PX).data;
}

/** The map tile's 256 px cell of a source tile. */
export async function cut(bmp: ImageBitmap, nt: NativeTile): Promise<ImageBitmap | null> {
  if (nt.n === 1 && bmp.width === SAT_PX && bmp.height === SAT_PX) return bmp;
  const sw = bmp.width / nt.n;
  const sh = bmp.height / nt.n;
  return createImageBitmap(bmp, nt.col * sw, nt.row * sh, sw, sh, { resizeWidth: SAT_PX, resizeHeight: SAT_PX, resizeQuality: 'high' }).catch(() => null);
}

/** PNG where any pixel is still transparent, so a reader can tell no-data from white; JPEG otherwise. */
export async function encodeTile(rgba: Uint8ClampedArray, quality = 0.85): Promise<Uint8Array> {
  const c = ctx();
  c.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, SAT_PX, SAT_PX), 0, 0);
  const type = noDataShare(rgba) > 0 ? 'image/png' : 'image/jpeg';
  const blob = await (c.canvas as OffscreenCanvas).convertToBlob({ type, quality });
  return new Uint8Array(await blob.arrayBuffer());
}

/** An offline tile's type by its magic bytes; a satellite pack mixes JPEG and PNG. */
export const imageType = (buf: ArrayBuffer): string => (buf.byteLength > 1 && new Uint8Array(buf, 0, 2).join() === '137,80' ? 'image/png' : 'image/jpeg');

/** The blob typed by its magic bytes, or null when it holds no image (an error sent as 200 JSON or XML). */
export async function asImage(blob: Blob | null | undefined): Promise<Blob | null> {
  if (!blob?.size) return null;
  const type = sniffImage(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
  if (!type) return null;
  return blob.type === type ? blob : new Blob([blob], { type });
}

/** RGBA of a source's 256 px map tile, or null when it can't be had. */
export type MaskLoader = (s: SatSource, z: number, x: number, y: number) => Promise<Uint8ClampedArray | null>;

/** Clears an opaque source's white fill from a map tile in place, by the fill of the coarse tile above it; returns pixels cleared. */
export function fillMasks(load: MaskLoader): (s: SatSource, z: number, x: number, y: number, rgba: Uint8ClampedArray) => Promise<number> {
  const cache = new Map<string, Promise<Uint8Array | null>>();
  const maskOf = (s: SatSource, z: number, x: number, y: number) => {
    const key = `${s.id}/${z}/${x}/${y}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const p = load(s, z, x, y).then((rgba) => (rgba ? fillMask(rgba) : null));
    cache.set(key, p);
    if (cache.size > MASKS_MAX) cache.delete(cache.keys().next().value as string);
    // A failed mask is retried by the next tile; until then nothing is cleared.
    void p.then((m) => m || cache.get(key) !== p || cache.delete(key));
    return p;
  };
  return async (s, z, x, y, rgba) => {
    if (!needsFillMask(s, rgba)) return 0;
    const mt = maskTile(s, z, x, y);
    const mask = mt.z === z ? fillMask(rgba) : await maskOf(s, mt.z, mt.x, mt.y).catch(() => null);
    return mask ? clearFill(rgba, mask, mt) : 0;
  };
}
