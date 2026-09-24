/** The reader's `DracoDecoder` over the draco3d Emscripten module. */
// oxlint-disable no-underscore-dangle -- Emscripten's own export names

import type { DracoDecoder } from './gltf';

interface DracoStatus {
  ok(): boolean;
  error_msg(): string;
}
interface DracoPtr {
  ptr: number;
}
interface DracoMesh extends DracoPtr {
  num_faces(): number;
  num_points(): number;
}
interface DracoAttribute extends DracoPtr {
  num_components(): number;
}
interface DracoNativeDecoder extends DracoPtr {
  DecodeArrayToMesh(data: Int8Array | Uint8Array, size: number, mesh: DracoMesh): DracoStatus;
  GetAttributeByUniqueId(mesh: DracoMesh, id: number): DracoAttribute;
  GetTrianglesUInt32Array(mesh: DracoMesh, bytes: number, ptr: number): boolean;
  GetAttributeDataArrayForAllPoints(mesh: DracoMesh, attr: DracoAttribute, type: number, bytes: number, ptr: number): boolean;
}

/** The part of draco3d's decoder module this adapter calls. */
export interface DracoModule {
  Decoder: new () => DracoNativeDecoder;
  Mesh: new () => DracoMesh;
  DT_FLOAT32: number;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  destroy(o: DracoPtr): void;
}

export function dracoDecoder(m: DracoModule): DracoDecoder {
  return {
    decode(data, attributes) {
      const dec = new m.Decoder();
      const mesh = new m.Mesh();
      try {
        const st = dec.DecodeArrayToMesh(data, data.byteLength, mesh);
        if (!st.ok() || mesh.ptr === 0) throw new Error(st.error_msg() || 'not a Draco mesh');
        const n = mesh.num_faces() * 3;
        const ip = m._malloc(n * 4);
        let indices: Uint32Array;
        try {
          dec.GetTrianglesUInt32Array(mesh, n * 4, ip);
          // The heap may have grown during the call, so read it afterwards.
          indices = m.HEAPU32.slice(ip >> 2, (ip >> 2) + n);
        } finally {
          m._free(ip);
        }
        const out: Record<string, Float32Array> = {};
        for (const [name, id] of Object.entries(attributes)) {
          const a = dec.GetAttributeByUniqueId(mesh, id);
          if (!a || a.ptr === 0) continue;
          const len = mesh.num_points() * a.num_components();
          const p = m._malloc(len * 4);
          try {
            if (!dec.GetAttributeDataArrayForAllPoints(mesh, a, m.DT_FLOAT32, len * 4, p)) throw new Error(`${name} does not decode`);
            out[name] = m.HEAPF32.slice(p >> 2, (p >> 2) + len);
          } finally {
            m._free(p);
          }
        }
        return { indices, attributes: out };
      } finally {
        m.destroy(mesh);
        m.destroy(dec);
      }
    }
  };
}
