import { describe, expect, it } from 'vitest';
import { AltitudeRef, lngLatToLocal, ModelSource, type SavedModel } from '@core/model';
import { GltfError, ModelOrigin, ModelUnit, packGltf } from './gltf';
import { modelHeightAt } from './heightAt';
import { importedMesh, modelFootprint, modelMesh, modelTopM } from './mesh';
import { rowsCentre } from './seed';

// Y-up box, 20 m along x (east), 30 m tall, 10 m along z (south).
const POS = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map((v, i) => v * [20, 30, 10][i % 3]);
const IDX = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

function boxGlb(): ArrayBuffer {
  const pos = new Uint8Array(new Float32Array(POS).buffer);
  const idx = new Uint8Array(new Uint32Array(IDX).buffer);
  const bin = new Uint8Array(pos.length + idx.length);
  bin.set(pos);
  bin.set(idx, pos.length);
  const doc = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' },
      { bufferView: 1, componentType: 5125, count: IDX.length, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length },
      { buffer: 0, byteOffset: pos.length, byteLength: idx.length }
    ],
    buffers: [{ byteLength: bin.length, uri: 'box.bin' }]
  };
  return packGltf(doc, new Map([['box.bin', bin.buffer]]));
}

const ANCHOR = { lat: 40.754, lng: -74.0008, altRef: AltitudeRef.Ground, altM: 0, headingDeg: 0, scale: 1 };

function imported(glb = boxGlb(), anchor = ANCHOR): SavedModel {
  const m: SavedModel = {
    id: 'm1',
    name: 'Box',
    source: ModelSource.Imported,
    anchor,
    glb,
    footprint: [],
    groundM: 2,
    suppressOverture: true,
    visible: true,
    attribution: '',
    notes: '',
    createdAt: 0,
    updatedAt: 0
  };
  return { ...m, footprint: modelFootprint(m) };
}

const local = (m: SavedModel, anchor = ANCHOR) => m.footprint.map(([lng, lat]) => lngLatToLocal(anchor, { lng, lat }));
const extent = (pts: [number, number][], k: 0 | 1) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));

describe('importedMesh', () => {
  it('parses once per buffer and options', () => {
    const glb = boxGlb();
    const a = importedMesh(glb);
    expect(importedMesh(glb)).toBe(a);
    expect(importedMesh(glb, { units: ModelUnit.Cm, zUp: false, origin: ModelOrigin.BaseCentre })).not.toBe(a);
    expect(a.mesh.idx.length / 3).toBe(12);
  });

  it('throws the same GltfError each time for bad bytes', () => {
    const bad = new ArrayBuffer(16);
    let first: unknown;
    try {
      importedMesh(bad);
    } catch (e) {
      first = e;
    }
    expect(first).toBeInstanceOf(GltfError);
    expect(() => importedMesh(bad)).toThrow(first as Error);
  });
});

describe('Imported models', () => {
  it('draw the file mesh stood on its base centre', () => {
    const m = imported();
    const { box } = modelMesh(m);
    expect(box[2]).toBeCloseTo(0, 6);
    expect(box[5]).toBeCloseTo(30, 6);
    expect(box[0] + box[3]).toBeCloseTo(0, 6);
    expect(modelTopM(m)).toBeCloseTo(30, 6);
  });

  it('have a footprint that follows a move and a turn', () => {
    const m = imported();
    const pts = local(m);
    expect(extent(pts, 0)).toBeCloseTo(20, 3);
    expect(extent(pts, 1)).toBeCloseTo(10, 3);
    const moved = { ...ANCHOR, lat: ANCHOR.lat + 0.001 };
    const m2 = imported(m.glb, moved);
    expect(m2.footprint[0][1] - m.footprint[0][1]).toBeCloseTo(0.001, 9);
    const turned = { ...ANCHOR, headingDeg: 90 };
    const t = local(imported(m.glb, turned), { ...ANCHOR });
    expect(extent(t, 0)).toBeCloseTo(10, 3);
    expect(extent(t, 1)).toBeCloseTo(20, 3);
  });

  it('answer the target height inside the footprint', () => {
    const m = imported();
    expect(modelHeightAt([m], ANCHOR)?.heightM).toBeCloseTo(30, 6);
    const big = imported(m.glb, { ...ANCHOR, altM: 4, scale: 2 });
    expect(modelHeightAt([big], ANCHOR)?.heightM).toBeCloseTo(4 + 60, 6);
    expect(modelHeightAt([m], { lat: ANCHOR.lat + 0.001, lng: ANCHOR.lng })).toBeNull();
  });
});

describe('rowsCentre', () => {
  it('is the bounding-box centre of every vertex', () => {
    expect(rowsCentre({ count: 2, ringStart: Int32Array.of(0, 2, 3), lng: Float64Array.of(0, 2, 4), lat: Float64Array.of(1, 3, 1) })).toEqual({ lng: 2, lat: 2 });
    expect(rowsCentre({ count: 0, ringStart: Int32Array.of(0), lng: new Float64Array(), lat: new Float64Array() })).toBeNull();
  });
});
