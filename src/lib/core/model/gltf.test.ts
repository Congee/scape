import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMPRESSED_MESSAGE, GltfError, ModelOrigin, ModelUnit, parseGlb, parseGltf, propertyColumn, readGlbWorld, validateMesh, writeGlb, type ImportOptions } from './gltf';
import type { ModelMesh } from '@core/model';

const KEEP: ImportOptions = { units: ModelUnit.M, zUp: false, origin: ModelOrigin.Keep };

/** Builds glTF documents with one binary buffer, in-memory. */
class Fixture {
  bytes: number[] = [];
  doc: { asset: object; accessors: object[]; bufferViews: object[]; meshes: { primitives: object[] }[]; nodes: object[]; scenes?: object[] } = { asset: { version: '2.0' }, accessors: [], bufferViews: [], meshes: [], nodes: [] };

  private view(data: Uint8Array, byteStride?: number): number {
    while (this.bytes.length % 4) this.bytes.push(0);
    this.doc.bufferViews.push({ buffer: 0, byteOffset: this.bytes.length, byteLength: data.length, ...(byteStride ? { byteStride } : {}) });
    for (const b of data) this.bytes.push(b);
    return this.doc.bufferViews.length - 1;
  }

  positions(p: number[]): number {
    const bufferView = this.view(new Uint8Array(new Float32Array(p).buffer));
    return this.doc.accessors.push({ bufferView, componentType: 5126, count: p.length / 3, type: 'VEC3' }) - 1;
  }

  indices(i: number[], componentType: 5121 | 5123 | 5125 = 5125): number {
    const arr = componentType === 5121 ? new Uint8Array(i) : componentType === 5123 ? new Uint16Array(i) : new Uint32Array(i);
    const bufferView = this.view(new Uint8Array(arr.buffer));
    return this.doc.accessors.push({ bufferView, componentType, count: i.length, type: 'SCALAR' }) - 1;
  }

  /** Raw view for interleaved accessors. */
  raw(data: Uint8Array, byteStride?: number): number {
    return this.view(data, byteStride);
  }

  mesh(primitives: object[]): number {
    return this.doc.meshes.push({ primitives }) - 1;
  }

  node(n: object): number {
    return this.doc.nodes.push(n) - 1;
  }

  json(): Record<string, unknown> {
    return { ...this.doc, buffers: [{ byteLength: this.bytes.length }], scenes: this.doc.scenes ?? [{ nodes: [0] }] };
  }

  glb(): ArrayBuffer {
    return glb(this.json(), new Uint8Array(this.bytes));
  }
}

function glb(json: object, bin?: Uint8Array): ArrayBuffer {
  const j = new TextEncoder().encode(JSON.stringify(json));
  const jl = (j.length + 3) & ~3;
  const bl = bin ? (bin.length + 3) & ~3 : 0;
  const total = 12 + 8 + jl + (bin ? 8 + bl : 0);
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  u8.fill(0x20, 20, 20 + jl);
  u8.set(j, 20);
  if (bin) {
    dv.setUint32(20 + jl, bl, true);
    dv.setUint32(24 + jl, 0x004e4942, true);
    u8.set(bin, 28 + jl);
  }
  return out;
}

// Unit cube 0..1 on every axis, 12 triangles, counter-clockwise from outside.
const CUBE_POS = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
const CUBE_IDX = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

function cube(componentType: 5121 | 5123 | 5125 = 5125, node: object = {}): Fixture {
  const f = new Fixture();
  const mesh = f.mesh([{ attributes: { POSITION: f.positions(CUBE_POS) }, indices: f.indices(CUBE_IDX, componentType) }]);
  f.node({ mesh, ...node });
  return f;
}

const tri = (pos: number[], idx: number[]): ModelMesh => ({ pos: new Float32Array(pos), idx: new Uint32Array(idx), box: new Float32Array(6) });
const tris = (m: ModelMesh) => m.idx.length / 3;
const vert = (m: ModelMesh, i: number) => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
const box = (m: ModelMesh) => Array.from(m.box);

/** Signed volume, positive when every face winds counter-clockwise from outside. */
function volume(m: ModelMesh): number {
  let v = 0;
  for (let t = 0; t < m.idx.length; t += 3) {
    const [a, b, c] = [vert(m, m.idx[t]), vert(m, m.idx[t + 1]), vert(m, m.idx[t + 2])];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

function expectError(fn: () => unknown, msg: string | RegExp) {
  expect(fn).toThrow(GltfError);
  expect(fn).toThrow(msg);
}

describe('parseGlb', () => {
  it('reads a cube, mapping E = x, N = −z, U = y', () => {
    const { mesh, warnings } = parseGlb(cube().glb(), KEEP);
    expect(warnings).toEqual([]);
    expect(tris(mesh)).toBe(12);
    expect(box(mesh)).toEqual([0, -1, 0, 1, 0, 1]);
    expect(vert(mesh, 4)).toEqual([0, -1, 0]);
    expect(volume(mesh)).toBeCloseTo(1, 9);
  });

  it.each([5121, 5123, 5125] as const)('reads component type %i indices', (t) => {
    const { mesh } = parseGlb(cube(t).glb(), KEEP);
    expect(Array.from(mesh.idx)).toEqual(CUBE_IDX);
  });

  it('centres the base by default', () => {
    const { mesh } = parseGlb(cube(5125, { translation: [100, 50, -20] }).glb());
    expect(box(mesh)).toEqual([-0.5, -0.5, 0, 0.5, 0.5, 1]);
  });

  it('honours Z-up and units', () => {
    const f = cube(5125, { scale: [1, 2, 3] });
    const zUp = parseGlb(f.glb(), { ...KEEP, zUp: true });
    expect(box(zUp.mesh)).toEqual([0, 0, 0, 1, 2, 3]);
    expect(volume(zUp.mesh)).toBeCloseTo(6, 9);
    const ft = parseGlb(f.glb(), { units: ModelUnit.Ft, zUp: true, origin: ModelOrigin.Keep });
    expect(ft.mesh.box[5]).toBeCloseTo(3 * 0.3048, 6);
    for (const [u, k] of [
      [ModelUnit.Cm, 0.01],
      [ModelUnit.Mm, 0.001],
      [ModelUnit.In, 0.0254]
    ] as const)
      expect(parseGlb(f.glb(), { units: u, zUp: true, origin: ModelOrigin.Keep }).mesh.box[4]).toBeCloseTo(2 * k, 7);
  });

  it('composes a node hierarchy of matrix and TRS', () => {
    const f = new Fixture();
    const mesh = f.mesh([{ attributes: { POSITION: f.positions(CUBE_POS) }, indices: f.indices(CUBE_IDX) }]);
    // Root: column-major translate (10, 0, 0); child: 90° about +y then scale 2.
    const s = Math.SQRT1_2;
    f.node({ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1], children: [1] });
    f.node({ translation: [0, 5, 0], rotation: [0, s, 0, s], scale: [2, 2, 2], mesh });
    const { mesh: m } = parseGlb(f.glb(), KEEP);
    // Rotation about +y takes x→−z, z→x: file box x 10..12, y 5..7, z −2..0.
    const b = box(m);
    const want = [10, 0, 5, 12, 2, 7];
    for (let i = 0; i < 6; i++) expect(b[i]).toBeCloseTo(want[i], 6);
    expect(volume(m)).toBeCloseTo(8, 5);
  });

  it('keeps outward winding under a mirroring node', () => {
    const { mesh } = parseGlb(cube(5125, { scale: [-1, 1, 1] }).glb(), KEEP);
    expect(box(mesh)).toEqual([-1, -1, 0, 0, 0, 1]);
    expect(volume(mesh)).toBeCloseTo(1, 9);
  });

  it('uses the chosen scene', () => {
    const f = cube();
    f.node({ mesh: 0, translation: [0, 100, 0] });
    const doc = { ...f.json(), scene: 1, scenes: [{ nodes: [0] }, { nodes: [1] }] };
    expect(parseGltf(doc, new Map(), KEEP, new Uint8Array(f.bytes).buffer).mesh.box[2]).toBe(100);
    expectError(() => parseGltf({ ...doc, scene: 5 }, new Map(), KEEP, new Uint8Array(f.bytes).buffer), 'Scene 5 does not exist.');
  });

  it('triangulates a strip and a fan with the spec winding', () => {
    const f = new Fixture();
    // Strip along +x in the ground plane (y = 0): z alternates 0, 1 so faces point up.
    const strip = f.positions([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 2, 0, 0]);
    const fan = f.positions([0, 1, 0, 1, 1, 0, 1, 1, -1, 0, 1, -1]);
    f.node({ mesh: f.mesh([{ attributes: { POSITION: strip }, mode: 5 }, { attributes: { POSITION: fan }, mode: 6 }]) });
    const { mesh } = parseGlb(f.glb(), KEEP);
    expect(Array.from(mesh.idx)).toEqual([0, 1, 2, 1, 3, 2, 2, 3, 4, 6, 7, 5, 7, 8, 5]);
    for (let t = 0; t < mesh.idx.length; t += 3) {
      const [a, b, c] = [vert(mesh, mesh.idx[t]), vert(mesh, mesh.idx[t + 1]), vert(mesh, mesh.idx[t + 2])];
      // Up component of (b − a) × (c − a) in ENU.
      expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0);
    }
  });

  it('skips points and lines with a warning', () => {
    const f = cube();
    const p = f.positions([0, 0, 0, 1, 1, 1]);
    f.doc.meshes[0].primitives.push({ attributes: { POSITION: p }, mode: 0 }, { attributes: { POSITION: p }, mode: 1 });
    const r = parseGlb(f.glb(), KEEP);
    expect(tris(r.mesh)).toBe(12);
    expect(r.warnings).toEqual(['Skipped 2 point, line or position-less primitives.']);
  });

  it('honours byteStride on interleaved positions', () => {
    const f = new Fixture();
    // Position, then a 12-byte normal, per vertex.
    const data = new Float32Array([0, 0, 0, 9, 9, 9, 1, 0, 0, 9, 9, 9, 0, 0, -1, 9, 9, 9]);
    const bufferView = f.raw(new Uint8Array(data.buffer), 24);
    f.doc.accessors.push({ bufferView, componentType: 5126, count: 3, type: 'VEC3' });
    f.node({ mesh: f.mesh([{ attributes: { POSITION: 0 } }]) });
    const { mesh } = parseGlb(f.glb(), KEEP);
    expect(Array.from(mesh.pos)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('rejects Draco and meshopt with the exact message', () => {
    for (const ext of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression']) {
      const buf = glb({ asset: { version: '2.0' }, extensionsUsed: [ext], extensionsRequired: [ext] });
      expectError(() => parseGlb(buf), COMPRESSED_MESSAGE);
    }
    expect(COMPRESSED_MESSAGE).toBe(
      'Compressed mesh (Draco/meshopt) is not supported. Re-export from Blender with Compression off, or run `gltf-transform copy in.glb out.glb`.'
    );
  });

  it('rejects any other required extension', () => {
    expectError(() => parseGlb(glb({ asset: { version: '2.0' }, extensionsRequired: ['KHR_mesh_quantization'] })), 'Unsupported required extension: KHR_mesh_quantization.');
  });

  it('rejects sparse accessors, non-float positions and bad indices', () => {
    const sparse = cube();
    (sparse.doc.accessors[0] as Record<string, unknown>).sparse = { count: 1 };
    expectError(() => parseGlb(sparse.glb()), 'Sparse accessors are not supported.');
    const short = cube();
    (short.doc.accessors[0] as Record<string, unknown>).componentType = 5123;
    expectError(() => parseGlb(short.glb()), 'POSITION must be FLOAT VEC3.');
    const range = new Fixture();
    range.node({ mesh: range.mesh([{ attributes: { POSITION: range.positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) }, indices: range.indices([0, 1, 3]) }]) });
    expectError(() => parseGlb(range.glb()), 'Index 3 is out of range (3 vertices).');
    const over = cube();
    (over.doc.accessors[0] as Record<string, unknown>).count = 9;
    expectError(() => parseGlb(over.glb()), 'Accessor 0 runs past its buffer view.');
  });

  it('rejects malformed containers', () => {
    const good = cube().glb();
    const edit = (f: (dv: DataView) => void, len = good.byteLength) => {
      const b = good.slice(0, len);
      f(new DataView(b));
      return b;
    };
    expectError(() => parseGlb(edit((d) => d.setUint32(0, 0))), 'Not a GLB file.');
    expectError(() => parseGlb(edit((d) => d.setUint32(4, 1, true))), 'GLB version 1 is not supported; only glTF 2.0.');
    expectError(() => parseGlb(edit((d) => d.setUint32(8, good.byteLength + 4, true))), 'GLB length does not match the file.');
    expectError(() => parseGlb(edit((d) => d.setUint32(12, d.getUint32(12, true) + 4000, true))), 'GLB chunk runs past the end.');
    expectError(() => parseGlb(edit((d) => d.setUint32(12, d.getUint32(12, true) - 2, true))), 'GLB chunk is not 4-byte aligned.');
    expectError(() => parseGlb(edit((d) => d.setUint32(16, 0x004e4942, true))), 'GLB does not start with a JSON chunk.');
    const jl = new DataView(good).getUint32(12, true);
    expectError(() => parseGlb(edit((d) => d.setUint32(8, 20 + jl + 4, true))), 'GLB chunk header runs past the end.');
    // BIN chunk shorter than buffers[0].byteLength.
    const binAt = 20 + jl;
    expectError(() => parseGlb(edit((d) => (d.setUint32(8, binAt + 8 + 8, true), d.setUint32(binAt, 8, true)))), 'Buffer 0 is shorter than its byteLength.');
    expectError(() => parseGlb(new ArrayBuffer(8)), 'Not a GLB file.');
  });
});

describe('parseGltf', () => {
  it('reads data: URIs and external .bin resources', () => {
    const f = cube();
    const bin = new Uint8Array(f.bytes);
    const b64 = btoa(String.fromCharCode(...bin));
    const inline = { ...f.json(), buffers: [{ uri: `data:application/octet-stream;base64,${b64}`, byteLength: bin.length }] };
    expect(tris(parseGltf(JSON.stringify(inline), new Map(), KEEP).mesh)).toBe(12);
    const ext = { ...f.json(), buffers: [{ uri: 'sub/my%20cube.bin', byteLength: bin.length }] };
    expect(tris(parseGltf(ext, new Map([['my cube.bin', bin.buffer]]), KEEP).mesh)).toBe(12);
    expectError(() => parseGltf(ext, new Map(), KEEP), 'Missing sub/my cube.bin; pick it together with the .gltf file.');
  });

  it('rejects a non-2.0 asset', () => {
    expectError(() => parseGltf({ asset: { version: '1.0' } }, new Map()), 'Only glTF 2.0 is supported.');
    expectError(() => parseGltf('{', new Map()), 'The .gltf file is not valid JSON.');
  });
});

describe('validateMesh', () => {
  it('reports stats and the plan-view hull', () => {
    const { mesh } = parseGlb(cube(5125, { scale: [10, 30, 20] }).glb());
    const v = validateMesh(mesh);
    expect(v.stats).toEqual({ vertices: 8, triangles: 12, heightM: 30, widthM: 10, depthM: 20 });
    expect(v.hull).toEqual([
      [-5, -10],
      [5, -10],
      [5, 10],
      [-5, 10]
    ]);
    expect(v.degenerate).toBe(0);
    expect(v.warnings).toEqual([]);
  });

  it('drops degenerate triangles and unused vertices', () => {
    const mesh: ModelMesh = {
      pos: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 1, 0, 0, 7, 7, 7]),
      idx: new Uint32Array([0, 1, 2, 0, 0, 2, 0, 3, 1]),
      box: new Float32Array(6)
    };
    const v = validateMesh(mesh);
    expect(v.degenerate).toBe(2);
    expect(v.warnings).toEqual(['Dropped 2 degenerate triangles.']);
    expect(Array.from(v.mesh.idx)).toEqual([0, 1, 2]);
    expect(Array.from(v.mesh.pos)).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    expect(Array.from(v.mesh.box)).toEqual([0, 0, 0, 2, 2, 0]);
  });

  it('warns on sizes that suggest wrong units', () => {
    const { mesh } = parseGlb(cube().glb(), { units: ModelUnit.Cm, zUp: false, origin: ModelOrigin.BaseCentre });
    expect(validateMesh(mesh).warnings).toEqual(['The model is under 1 m across; check the units.']);
    const big = parseGlb(cube(5125, { scale: [3000, 1, 1] }).glb()).mesh;
    expect(validateMesh(big).warnings).toEqual(['The model is over 2 km across; check the units.']);
  });

  it('rejects non-finite positions, bad indices, empty and oversized meshes', () => {
    expectError(() => validateMesh(tri([0, 0, 0, 1, 0, 0, 0, Number.NaN, 0], [0, 1, 2])), 'Mesh has non-finite positions.');
    expectError(() => validateMesh(tri([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 5])), 'Index 5 is out of range (3 vertices).');
    expectError(() => validateMesh(tri([0, 0, 0], [0, 0, 0])), 'The file has no triangles.');
    const n = 500_001;
    const idx = new Uint32Array(n * 3);
    for (let t = 0; t < n; t++) idx.set([0, 1, 2], t * 3);
    expectError(() => validateMesh({ pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), idx, box: new Float32Array(6) }), 'The model has 500,001 triangles; the limit is 500,000. Decimate it first.');
  });
});

describe('writeGlb', () => {
  const extras = { anchor: { lat: 40.7536, lng: -74.0021, altRef: 'Ground', altM: 0, headingDeg: 12.5, scale: 1 }, footprint: [[-74.0022, 40.7535], [-74.002, 40.7537]], note: 'ü ✓' };

  it('round-trips positions, indices and extras byte-identically', () => {
    const src = validateMesh(parseGlb(cube(5125, { translation: [3, 0, 4], scale: [10, 30, 20] }).glb(), KEEP).mesh).mesh;
    const out = writeGlb(src, extras);
    expect(out.byteLength % 4).toBe(0);
    const back = parseGlb(out, KEEP);
    expect(back.warnings).toEqual([]);
    expect(Array.from(back.mesh.pos)).toEqual(Array.from(src.pos));
    expect(Array.from(back.mesh.idx)).toEqual(Array.from(src.idx));
    expect(Array.from(back.mesh.box)).toEqual(Array.from(src.box));
    expect(JSON.stringify(back.scape)).toBe(JSON.stringify(extras));
    expect(new Uint8Array(writeGlb(back.mesh, back.scape))).toEqual(new Uint8Array(out));
  });

  it('writes glTF axes and POSITION bounds', () => {
    const out = writeGlb({ pos: new Float32Array([1, 2, 3, 0, 0, 0, 1, 0, 0]), idx: new Uint32Array([0, 1, 2]), box: new Float32Array(6) }, null);
    const jl = new DataView(out).getUint32(12, true);
    const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(out, 20, jl)));
    expect(doc.accessors[0]).toMatchObject({ min: [0, 0, -2], max: [1, 3, 0] });
    expect(doc.asset).toEqual({ version: '2.0', generator: 'Scape', extras: { scape: null } });
  });
});

/** A 3D Tiles-style GLB: meshopt views over a fallback buffer, int16 positions, float feature ids, one property table. */
function worldGlb(): ArrayBuffer {
  // Two triangles, positions normalized int16 scaled by 100 through the node; stride 8 for alignment.
  const q = [
    [0, 0, 0],
    [32767, 0, 0],
    [0, 32767, 0],
    [0, 0, -32767],
    [-32768, 0, 0],
    [0, 0, 16384]
  ];
  const pos = new Int16Array(q.length * 4);
  q.forEach((v, i) => pos.set(v, i * 4));
  const fid = new Float32Array([0, 0, 0, 1, 1, 1]);
  const idx = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const height = new Float32Array([12.5, -9999]);
  const names = new TextEncoder().encode('NL.1NL.22');
  const offsets = new Uint32Array([0, 4, 9]);
  const bytes: number[] = [];
  const views: object[] = [];
  const put = (data: Uint8Array) => {
    while (bytes.length % 4) bytes.push(0);
    const byteOffset = bytes.length;
    for (const b of data) bytes.push(b);
    return byteOffset;
  };
  const meshopt = (raw: ArrayBufferView, count: number, byteStride: number, mode: string, target?: number) => {
    const enc = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(raw.buffer), count, byteStride, mode);
    const byteOffset = put(enc);
    views.push({ buffer: 1, byteLength: count * byteStride, byteStride: mode === 'ATTRIBUTES' ? byteStride : undefined, target, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset, byteLength: enc.length, byteStride, count, mode } } });
    return views.length - 1;
  };
  const plain = (raw: ArrayBufferView) => {
    const u8 = new Uint8Array(raw.buffer);
    views.push({ buffer: 0, byteOffset: put(u8), byteLength: u8.length });
    return views.length - 1;
  };
  const vPos = meshopt(pos, q.length, 8, 'ATTRIBUTES');
  const vFid = meshopt(fid, fid.length, 4, 'ATTRIBUTES');
  const vIdx = meshopt(idx, idx.length, 4, 'TRIANGLES');
  const vH = plain(height);
  const vN = plain(names);
  const vO = plain(offsets);
  while (bytes.length % 4) bytes.push(0);
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_structural_metadata', 'EXT_mesh_features'],
    extensionsRequired: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    buffers: [{ byteLength: bytes.length }, { byteLength: 1024, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    bufferViews: views,
    accessors: [
      { bufferView: vPos, componentType: 5122, normalized: true, count: q.length, type: 'VEC3' },
      { bufferView: vFid, componentType: 5126, count: fid.length, type: 'SCALAR' },
      { bufferView: vIdx, componentType: 5125, count: idx.length, type: 'SCALAR' }
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, _FEATURE_ID_0: 1 }, indices: 2 }] }],
    nodes: [{ mesh: 0, matrix: [100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, 1000, 0, 0, 1] }],
    scenes: [{ nodes: [0] }],
    extensions: {
      EXT_structural_metadata: {
        schema: { classes: { b: { properties: { h: { type: 'SCALAR', componentType: 'FLOAT32', noData: -9999 }, id: { type: 'STRING' } } } } },
        propertyTables: [{ class: 'b', count: 2, properties: { h: { values: vH }, id: { values: vN, stringOffsets: vO, stringOffsetType: 'UINT32' } } }]
      }
    }
  };
  return glb(json, new Uint8Array(bytes));
}

describe('readGlbWorld', () => {
  beforeAll(async () => {
    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
  });

  it('decodes meshopt views, dequantizes positions through the node, and keeps feature ids', () => {
    const w = readGlbWorld(worldGlb(), MeshoptDecoder);
    expect(Array.from(w.idx)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(w.feature)).toEqual([0, 0, 0, 1, 1, 1]);
    const v = (i: number) => Array.from(w.pos.subarray(i * 3, i * 3 + 3));
    expect(v(0)).toEqual([1000, 0, 0]);
    expect(v(1)).toEqual([1100, 0, 0]);
    expect(v(3)).toEqual([1000, 0, -100]);
    // -32768 clamps to -1.
    expect(v(4)).toEqual([900, 0, 0]);
    expect(v(5)[2]).toBeCloseTo((16384 / 32767) * 100, 9);
  });

  it('reads property columns, noData as NaN, strings by offset', () => {
    const w = readGlbWorld(worldGlb(), MeshoptDecoder);
    expect(propertyColumn(w, 0, 'h')).toEqual([12.5, NaN]);
    expect(propertyColumn(w, 0, 'id')).toEqual(['NL.1', 'NL.22']);
    expect(propertyColumn(w, 0, 'missing')).toBeUndefined();
    expect(propertyColumn(w, 1, 'h')).toBeUndefined();
  });

  it('wraps a corrupt meshopt stream in GltfError', () => {
    const buf = worldGlb();
    const u8 = new Uint8Array(buf);
    // Clobber the start of the binary chunk, where the first meshopt stream lives.
    const jl = new DataView(buf).getUint32(12, true);
    u8.fill(0xff, 28 + jl, 28 + jl + 8);
    expectError(() => readGlbWorld(buf, MeshoptDecoder), /meshopt data is not valid/);
  });

  it('still refuses meshopt and quantization on the model import path', () => {
    expectError(() => parseGlb(worldGlb(), KEEP), COMPRESSED_MESSAGE);
  });
});
