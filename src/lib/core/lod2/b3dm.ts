/** 3D Tiles 1.0 Batched 3D Model: the embedded GLB, its RTC centre and the JSON batch table. */

import { GltfError } from '@core/model/gltf';

const MAGIC = 0x6d643362; // 'b3dm'
const HEADER = 28;

export interface B3dm {
  glb: ArrayBuffer;
  /** Feature-table `RTC_CENTER`, in the tile's z-up frame. */
  rtc?: [number, number, number];
  /** Batch-table columns stored as JSON arrays; binary columns are left out. */
  batch: Record<string, unknown[]>;
}

export function isB3dm(buf: ArrayBuffer): boolean {
  return buf.byteLength >= 4 && new DataView(buf).getUint32(0, true) === MAGIC;
}

function json(buf: ArrayBuffer, at: number, len: number, what: string): Record<string, unknown> {
  if (len === 0) return {};
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, at, len)));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    throw new GltfError(`b3dm ${what} JSON is not valid.`);
  }
}

export function readB3dm(buf: ArrayBuffer): B3dm {
  if (!isB3dm(buf) || buf.byteLength < HEADER) throw new GltfError('Not a b3dm tile.');
  const dv = new DataView(buf);
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new GltfError(`b3dm version ${version} is not supported.`);
  const length = dv.getUint32(8, true);
  const [ftJson, ftBin, btJson, btBin] = [12, 16, 20, 24].map((o) => dv.getUint32(o, true));
  const glbAt = HEADER + ftJson + ftBin + btJson + btBin;
  if (length > buf.byteLength || glbAt > length) throw new GltfError('b3dm length does not match the file.');
  const ft = json(buf, HEADER, ftJson, 'feature table');
  const bt = json(buf, HEADER + ftJson + ftBin, btJson, 'batch table');
  const c = ft.RTC_CENTER;
  const rtc = Array.isArray(c) && c.length === 3 && c.every(Number.isFinite) ? (c as [number, number, number]) : undefined;
  const batch: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(bt)) if (Array.isArray(v)) batch[k] = v;
  return { glb: buf.slice(glbAt, length), rtc, batch };
}
