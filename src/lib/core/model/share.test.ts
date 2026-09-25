import { describe, expect, it } from 'vitest';
import { AltitudeRef, ModelSource, partsFootprint, type ModelAnchor, type ModelPart, type SavedModel } from '@core/model';
import { RoofShape } from '@workers/buildings.protocol';
import { COMPRESSED_MESSAGE, GltfError, ModelOrigin, ModelUnit, parseGlb, readGlb, type ImportOptions } from './gltf';
import { partsMesh } from './mesh';
import { decodeExtras, exportModelGlb, fromModelRecord, importModelFile, isModelRecord, modelFileName, modelRecord, placeDraft, toBase64 } from './share';

const KEEP: ImportOptions = { units: ModelUnit.M, zUp: false, origin: ModelOrigin.Keep };

// 10 m cube, 12 triangles.
const CUBE_POS = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map((v) => v * 10);
const CUBE_IDX = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

function cubeBin(): Uint8Array<ArrayBuffer> {
  const pos = new Uint8Array(new Float32Array(CUBE_POS).buffer);
  const idx = new Uint8Array(new Uint32Array(CUBE_IDX).buffer);
  const out = new Uint8Array(pos.length + idx.length);
  out.set(pos);
  out.set(idx, pos.length);
  return out;
}

/** A cube `.gltf`; `uri` undefined for a GLB's BIN chunk. */
function cubeDoc(uri?: string, extra: object = {}): Record<string, unknown> {
  const posBytes = CUBE_POS.length * 4;
  return {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' },
      { bufferView: 1, componentType: 5125, count: CUBE_IDX.length, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes },
      { buffer: 0, byteOffset: posBytes, byteLength: CUBE_IDX.length * 4 }
    ],
    buffers: [{ byteLength: cubeBin().length, ...(uri === undefined ? {} : { uri }) }],
    ...extra
  };
}

const pad = (n: number) => (n + 3) & ~3;

/** GLB from JSON and BIN, plus any trailing chunks. */
function glb(json: object, bin: Uint8Array, more: { type: number; data: Uint8Array }[] = []): ArrayBuffer {
  const chunks = [{ type: 0x4e4f534a, data: new TextEncoder().encode(JSON.stringify(json)) }, { type: 0x004e4942, data: bin }, ...more];
  const total = chunks.reduce((n, c) => n + 8 + pad(c.data.length), 12);
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let at = 12;
  for (const c of chunks) {
    dv.setUint32(at, pad(c.data.length), true);
    dv.setUint32(at + 4, c.type, true);
    u8.set(c.data, at + 8);
    if (c.type === 0x4e4f534a) u8.fill(0x20, at + 8 + c.data.length, at + 8 + pad(c.data.length));
    at += 8 + pad(c.data.length);
  }
  return out;
}

const cubeGlb = (extra: object = {}) => glb(cubeDoc(undefined, extra), cubeBin());
const file = (data: ArrayBuffer | Uint8Array<ArrayBuffer> | string, name: string) => new File([data], name);
const binChunk = (b: ArrayBuffer) => {
  const len = new DataView(b).getUint32(12, true);
  return new Uint8Array(b, 20 + len + 8);
};

const ANCHOR: ModelAnchor = { lat: 40.7536, lng: -74.0012, altRef: AltitudeRef.Ground, altM: 0.25, headingDeg: 17.3, scale: 1 };

const PARTS: ModelPart[] = [
  { id: 'a', ring: [[-10, -10], [10, -10], [10, 10], [-10, 10]], baseM: 0, heightM: 30, roof: RoofShape.Gabled, roofHeightM: 4, roofDirDeg: NaN, roofAcross: 1 },
  { id: 'b', ring: [[0, 0], [3, 0], [3, 3], [0, 3]], baseM: 30, heightM: 50.125, roof: RoofShape.Pyramidal, roofHeightM: 0, roofDirDeg: 42.5, roofAcross: 0 }
];

function drawn(): SavedModel {
  return {
    id: 'd1',
    name: 'Tower / West',
    source: ModelSource.Drawn,
    anchor: ANCHOR,
    parts: PARTS,
    footprint: partsFootprint(ANCHOR, PARTS),
    groundM: NaN,
    suppressOverture: true,
    visible: true,
    attribution: 'Seeded from Overture Maps buildings (ODbL)',
    notes: 'n',
    createdAt: 1,
    updatedAt: 2
  };
}

function imported(importOptions: ImportOptions = KEEP): SavedModel {
  return {
    id: 'i1',
    name: 'Cube',
    source: ModelSource.Imported,
    anchor: { ...ANCHOR, altRef: AltitudeRef.Absolute, altM: 12.5, scale: 1.5 },
    glb: cubeGlb({ asset: { version: '2.0', generator: 'Blender', extras: { keep: 1 } } }),
    importOptions,
    footprint: [
      [-74.001, 40.75],
      [-74.0009, 40.75],
      [-74.0009, 40.7501]
    ],
    groundM: 3.5,
    suppressOverture: false,
    visible: true,
    attribution: '',
    notes: '',
    createdAt: 5,
    updatedAt: 6
  };
}

const rawScape = (b: ArrayBuffer) => (readGlb(b).json as { asset: { extras: { scape: Record<string, unknown> } } }).asset.extras.scape;

describe('exportModelGlb', () => {
  it('meshes a Drawn model and carries its placement and parts', () => {
    const m = drawn();
    const out = exportModelGlb(m);
    const back = parseGlb(out, KEEP);
    expect(back.mesh.idx.length).toBe(partsMesh(PARTS).idx.length);
    expect(decodeExtras(back.scape)).toEqual({ anchor: m.anchor, footprint: m.footprint, parts: m.parts, importOptions: KEEP });
    expect(JSON.stringify(decodeExtras(back.scape)?.anchor)).toBe(JSON.stringify(m.anchor));
    expect(JSON.stringify(decodeExtras(back.scape)?.footprint)).toBe(JSON.stringify(m.footprint));
  });

  it('writes a NaN roof direction as null and reads it back as NaN', () => {
    const out = exportModelGlb(drawn());
    const parts = rawScape(out).parts as { roofDirDeg: unknown }[];
    expect(parts.map((p) => p.roofDirDeg)).toEqual([null, 42.5]);
    const back = decodeExtras(parseGlb(out, KEEP).scape)!.parts!;
    expect(Number.isNaN(back[0].roofDirDeg)).toBe(true);
    expect(back[1].roofDirDeg).toBe(42.5);
  });

  it('leaves the parts out on request', () => {
    expect(rawScape(exportModelGlb(drawn(), false)).parts).toBeUndefined();
  });

  it('re-emits an Imported GLB with its other chunks and extras kept', () => {
    const tail = { type: 0x12345678, data: new Uint8Array([1, 2, 3, 4]) };
    const m = { ...imported(), glb: glb(cubeDoc(undefined, { asset: { version: '2.0', extras: { keep: 1 } } }), cubeBin(), [tail]) };
    const out = exportModelGlb(m);
    const doc = readGlb(out).json as { asset: { extras: Record<string, unknown> } };
    expect(doc.asset.extras.keep).toBe(1);
    expect(decodeExtras(doc.asset.extras.scape)).toEqual({ anchor: m.anchor, footprint: m.footprint, importOptions: KEEP });
    expect(Array.from(binChunk(out).subarray(0, cubeBin().length))).toEqual(Array.from(cubeBin()));
    expect(Array.from(new Uint8Array(out).subarray(-4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(parseGlb(out, KEEP).mesh.pos)).toEqual(Array.from(parseGlb(m.glb, KEEP).mesh.pos));
  });

  it('fails loudly without a mesh', () => {
    expect(() => exportModelGlb({ ...imported(), glb: undefined })).toThrow(GltfError);
  });
});

describe('importModelFile', () => {
  it('reads a .glb unplaced, with stats and a hull footprint to place', async () => {
    const bytes = cubeGlb();
    const imp = await importModelFile([file(bytes, 'Cube.GLB')], undefined, 7);
    expect(imp.draft.anchor).toBeNull();
    expect(imp.draft.footprint).toEqual([]);
    expect(imp.draft).toMatchObject({ name: 'Cube', source: ModelSource.Imported, createdAt: 7, updatedAt: 7, suppressOverture: true, visible: true });
    expect(imp.draft.importOptions).toEqual({ units: ModelUnit.M, zUp: false, origin: ModelOrigin.BaseCentre });
    expect(new Uint8Array(imp.draft.glb!)).toEqual(new Uint8Array(bytes));
    expect(imp.stats).toEqual({ vertices: 8, triangles: 12, heightM: 10, widthM: 10, depthM: 10 });
    expect(imp.hull).toHaveLength(4);
    expect(imp.warnings).toEqual([]);
    const placed = placeDraft(imp, ANCHOR);
    expect(placed.anchor).toBe(ANCHOR);
    expect(placed.footprint).toHaveLength(4);
    for (const [lng, lat] of placed.footprint) {
      expect(Math.abs(lng - ANCHOR.lng)).toBeLessThan(1e-4);
      expect(Math.abs(lat - ANCHOR.lat)).toBeLessThan(1e-4);
    }
  });

  it('reads a .gltf with a data: URI', async () => {
    const uri = `data:application/octet-stream;base64,${toBase64(cubeBin().slice().buffer)}`;
    const imp = await importModelFile([file(JSON.stringify(cubeDoc(uri)), 'cube.gltf')]);
    expect(imp.stats.triangles).toBe(12);
    expect(parseGlb(imp.draft.glb!).mesh.idx.length).toBe(36);
  });

  it('reads a .gltf picked with its .bin', async () => {
    const imp = await importModelFile([file(cubeBin(), 'cube%20data.bin'), file(JSON.stringify(cubeDoc('cube%20data.bin')), 'cube.gltf')]);
    expect(imp.stats).toMatchObject({ vertices: 8, triangles: 12 });
    expect(imp.draft.name).toBe('cube');
  });

  it('names a missing .bin', async () => {
    await expect(importModelFile([file(JSON.stringify(cubeDoc('cube.bin')), 'cube.gltf')])).rejects.toThrow('Missing cube.bin');
  });

  it('wants exactly one model file', async () => {
    await expect(importModelFile([file(cubeBin(), 'cube.bin')])).rejects.toThrow('Pick a .glb or .gltf file.');
    await expect(importModelFile([file(cubeGlb(), 'a.glb'), file(cubeGlb(), 'b.glb')])).rejects.toThrow('Pick one model at a time.');
  });

  it('takes raw GLB bytes', async () => {
    expect((await importModelFile(cubeGlb())).stats.triangles).toBe(12);
  });

  it('honours explicit options', async () => {
    const imp = await importModelFile([file(cubeGlb(), 'c.glb')], { units: ModelUnit.Cm, zUp: false, origin: ModelOrigin.BaseCentre });
    expect(imp.stats.heightM).toBeCloseTo(0.1, 6);
    expect(imp.warnings).toContain('The model is under 1 m across; check the units.');
  });

  it.each([
    ['required', { extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] }],
    ['used without a fallback', { extensionsUsed: ['EXT_meshopt_compression'], accessors: [{ componentType: 5126, count: 8, type: 'VEC3' }] }]
  ])('rejects a compressed mesh (%s)', async (_, extra) => {
    await expect(importModelFile([file(cubeGlb(extra), 'c.glb')])).rejects.toThrow(COMPRESSED_MESSAGE);
  });

  it('auto-places an exported Imported model with its options', async () => {
    const m = imported({ units: ModelUnit.Cm, zUp: false, origin: ModelOrigin.BaseCentre });
    const imp = await importModelFile([file(exportModelGlb(m), 'Cube.glb')]);
    expect(imp.draft.anchor).toEqual(m.anchor);
    expect(JSON.stringify(imp.draft.footprint)).toBe(JSON.stringify(m.footprint));
    expect(imp.draft.importOptions).toEqual(m.importOptions);
    expect(imp.stats.heightM).toBeCloseTo(0.1, 6);
  });

  it('restores an exported Drawn model as Drawn', async () => {
    const m = drawn();
    const imp = await importModelFile([file(exportModelGlb(m), modelFileName(m))]);
    expect(imp.draft.source).toBe(ModelSource.Drawn);
    expect(imp.draft.glb).toBeUndefined();
    expect(imp.draft.parts).toEqual(m.parts);
    expect(imp.warnings).toEqual([]);
    expect(imp.stats.triangles).toBe(partsMesh(PARTS).idx.length / 3);
    expect(JSON.stringify(imp.draft.anchor)).toBe(JSON.stringify(m.anchor));
    expect(JSON.stringify(imp.draft.footprint)).toBe(JSON.stringify(m.footprint));
    expect(imp.stats.heightM).toBeCloseTo(50.125, 3);
  });

  it('places a Drawn export without parts like any mesh', async () => {
    const m = drawn();
    const imp = await importModelFile([file(exportModelGlb(m, false), 'x.glb')]);
    expect(imp.draft.source).toBe(ModelSource.Imported);
    expect(imp.draft.anchor).toEqual(m.anchor);
    expect(imp.draft.importOptions).toEqual(KEEP);
    expect(imp.stats.triangles).toBe(partsMesh(PARTS).idx.length / 3);
  });

  it('ignores malformed extras with a warning', async () => {
    const imp = await importModelFile([file(cubeGlb({ asset: { version: '2.0', extras: { scape: { anchor: { lat: 'x' } } } } }), 'c.glb')]);
    expect(imp.draft.anchor).toBeNull();
    expect(imp.warnings).toContain('Ignored the Scape placement in the file: it is not valid.');
  });
});

const viaJson = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

describe('model records', () => {
  it.each([
    ['Drawn', drawn],
    ['Imported', imported]
  ])('round-trip a %s model through .scape.json with anchor and footprint byte-identical', (_, make) => {
    const m = make();
    const r = viaJson(modelRecord(m));
    expect(isModelRecord(r)).toBe(true);
    const back = fromModelRecord(r as ReturnType<typeof modelRecord>);
    expect(JSON.stringify(back.anchor)).toBe(JSON.stringify(m.anchor));
    expect(JSON.stringify(back.footprint)).toBe(JSON.stringify(m.footprint));
    const { glb: _g, ...rest } = back;
    const { glb: _m, ...want } = m;
    expect(rest).toEqual(want);
    if (m.glb) expect(Array.from(parseGlb(back.glb!, KEEP).mesh.pos)).toEqual(Array.from(parseGlb(m.glb, KEEP).mesh.pos));
  });

  it('keeps a NaN ground as NaN', () => {
    const r = viaJson(modelRecord(drawn())) as ReturnType<typeof modelRecord>;
    expect(r.groundM).toBeNull();
    expect(Number.isNaN(fromModelRecord(r).groundM)).toBe(true);
  });

  it('rejects a record whose GLB has no placement', () => {
    const r = { ...modelRecord(imported()), glb: toBase64(cubeGlb()) };
    expect(() => fromModelRecord(r)).toThrow('no valid Scape placement');
    expect(isModelRecord({ id: 'x', name: 'y', source: 'Nope', glb: '' })).toBe(false);
  });
});

describe('modelFileName', () => {
  it('keeps letters and replaces path characters', () => {
    expect(modelFileName({ name: 'Tower / West: 30 HY' })).toBe('Tower _ West_ 30 HY.glb');
    expect(modelFileName({ name: '東京タワー' })).toBe('東京タワー.glb');
    expect(modelFileName({ name: '  ' })).toBe('model.glb');
  });
});
