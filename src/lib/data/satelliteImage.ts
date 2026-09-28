/** Decoding and cutting satellite tiles. Worker-safe. */

import { type NativeTile, noDataShare } from '@core/tiles/satellite';

export const SAT_PX = 256;

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
