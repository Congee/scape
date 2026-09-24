/** glTF 2.0 / GLB import and export for precise building models: positions only; meshopt and Draco through injected decoders. */

import { convexHull, type ModelMesh } from '@core/model';

export const ModelUnit = { M: 'm', Cm: 'cm', Mm: 'mm', Ft: 'ft', In: 'in' } as const;
export type ModelUnit = (typeof ModelUnit)[keyof typeof ModelUnit];

export const ModelOrigin = { BaseCentre: 'BaseCentre', Keep: 'Keep' } as const;
export type ModelOrigin = (typeof ModelOrigin)[keyof typeof ModelOrigin];

export interface ImportOptions {
  units: ModelUnit;
  /** The file's up axis is +z (north +y) rather than glTF's +y. */
  zUp: boolean;
  origin: ModelOrigin;
}

export const DEFAULT_IMPORT: ImportOptions = { units: ModelUnit.M, zUp: false, origin: ModelOrigin.BaseCentre };

const UNIT_M: Record<ModelUnit, number> = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };

export const COMPRESSED_MESSAGE =
  'Compressed mesh (Draco/meshopt) is not supported. Re-export from Blender with Compression off, or run `gltf-transform copy in.glb out.glb`.';

const COMPRESSION_EXTENSIONS = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression']);
const MESHOPT = 'EXT_meshopt_compression';
const QUANTIZATION = 'KHR_mesh_quantization';
const DRACO = 'KHR_draco_mesh_compression';
const RTC = 'CESIUM_RTC';
const FEATURE_ID = '_FEATURE_ID_0';
/** 3D Tiles 1.0's per-vertex batch id. */
const BATCH_ID = '_BATCHID';
const NO_EXTENSIONS: ReadonlySet<string> = new Set();
const WORLD_EXTENSIONS: ReadonlySet<string> = new Set([MESHOPT, QUANTIZATION, DRACO, RTC]);

/** The part of meshoptimizer's decoder the reader needs. */
export interface MeshoptDecoder {
  decodeGltfBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string): void;
}

export const MAX_TRIANGLES = 500_000;

export class GltfError extends Error {
  override name = 'GltfError';
}

export interface GltfImport {
  mesh: ModelMesh;
  warnings: string[];
  /** `asset.extras.scape`, untouched. */
  scape: unknown;
}

/** One Draco-compressed primitive: its triangle list and the asked attributes, by Draco unique id, as floats. */
export interface DracoDecoder {
  decode(data: Uint8Array, attributes: Readonly<Record<string, number>>): { indices: Uint32Array; attributes: Record<string, Float32Array> };
}

export interface WorldDecoders {
  meshopt: MeshoptDecoder;
  /** Only needed when `gltfUsesDraco` says so. */
  draco?: DracoDecoder;
}

interface GltfNode {
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  extensions?: { KHR_draco_mesh_compression?: { bufferView: number; attributes: Record<string, number> } };
}
interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: unknown;
}
interface MeshoptView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: string;
  filter?: string;
}
interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  extensions?: { EXT_meshopt_compression?: MeshoptView };
}
interface GltfBuffer {
  uri?: string;
  byteLength: number;
  extensions?: { EXT_meshopt_compression?: { fallback?: boolean } };
}
interface GltfJson {
  asset?: { version?: string; extras?: { scape?: unknown } };
  extensionsRequired?: string[];
  extensionsUsed?: string[];
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: GltfBuffer[];
  extensions?: { EXT_structural_metadata?: StructuralMetadata; CESIUM_RTC?: { center?: number[] } };
}
interface MetadataProperty {
  type: string;
  componentType?: string;
  noData?: number;
}
interface StructuralMetadata {
  schema?: { classes?: Record<string, { properties?: Record<string, MetadataProperty> }> };
  propertyTables?: { class: string; count: number; properties?: Record<string, { values: number; stringOffsets?: number; stringOffsetType?: string }> }[];
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const FLOAT = 5126;
const INDEX_BYTES: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4 };

/** Parse a binary glTF (GLB v2). */
export function parseGlb(buf: ArrayBuffer, opts: ImportOptions = DEFAULT_IMPORT): GltfImport {
  const { json, bin } = readGlb(buf);
  return parseGltf(json, new Map(), opts, bin);
}

interface GlbChunk {
  type: number;
  data: Uint8Array;
}

/** The chunks of a GLB v2, checked. */
function glbChunks(buf: ArrayBuffer): GlbChunk[] {
  const dv = new DataView(buf);
  if (buf.byteLength < 20 || dv.getUint32(0, true) !== GLB_MAGIC) throw new GltfError('Not a GLB file.');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new GltfError(`GLB version ${version} is not supported; only glTF 2.0.`);
  const length = dv.getUint32(8, true);
  if (length > buf.byteLength || length < 20) throw new GltfError('GLB length does not match the file.');
  const chunks: GlbChunk[] = [];
  for (let at = 12; at < length; ) {
    if (at + 8 > length) throw new GltfError('GLB chunk header runs past the end.');
    const len = dv.getUint32(at, true);
    const type = dv.getUint32(at + 4, true);
    const start = at + 8;
    if (len % 4 !== 0) throw new GltfError('GLB chunk is not 4-byte aligned.');
    if (start + len > length) throw new GltfError('GLB chunk runs past the end.');
    if (chunks.length === 0 && type !== CHUNK_JSON) throw new GltfError('GLB does not start with a JSON chunk.');
    chunks.push({ type, data: new Uint8Array(buf, start, len) });
    at = start + len;
  }
  if (chunks.length === 0) throw new GltfError('GLB does not start with a JSON chunk.');
  return chunks;
}

/** A GLB's JSON document and BIN chunk, without reading any mesh. */
export function readGlb(buf: ArrayBuffer): { json: unknown; bin?: ArrayBuffer } {
  const chunks = glbChunks(buf);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(chunks[0].data));
  } catch {
    throw new GltfError('GLB JSON chunk is not valid JSON.');
  }
  const b = chunks[1]?.type === CHUNK_BIN ? chunks[1].data : undefined;
  return { json, bin: b && b.slice().buffer };
}

/** The same GLB with its JSON chunk replaced; every other chunk is kept byte for byte. */
export function replaceGlbJson(buf: ArrayBuffer, json: unknown): ArrayBuffer {
  const chunks = glbChunks(buf);
  chunks[0] = { type: CHUNK_JSON, data: new TextEncoder().encode(JSON.stringify(json)) };
  return assembleGlb(chunks);
}

function assembleGlb(chunks: GlbChunk[]): ArrayBuffer {
  const total = chunks.reduce((n, c) => n + 8 + pad4(c.data.length), 12);
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let at = 12;
  for (const c of chunks) {
    const len = pad4(c.data.length);
    dv.setUint32(at, len, true);
    dv.setUint32(at + 4, c.type, true);
    u8.set(c.data, at + 8);
    // JSON pads with spaces, BIN with zeros.
    if (c.type === CHUNK_JSON) u8.fill(0x20, at + 8 + c.data.length, at + 8 + len);
    at += 8 + len;
  }
  return out;
}

/** A `.gltf` and its buffers (data: URIs or `resources`) as one GLB; external images stay as URIs. */
export function packGltf(json: unknown, resources: ReadonlyMap<string, ArrayBuffer>): ArrayBuffer {
  const doc = parseDoc(json);
  const sources = compressedGuard(doc, () => (doc.buffers ?? []).map((b, i) => new Uint8Array(loadBuffer(b, i, resources), 0, b.byteLength)));
  const starts: number[] = [];
  let len = 0;
  for (const s of sources) {
    starts.push(len);
    len = pad4(len + s.length);
  }
  const bin = new Uint8Array(len);
  sources.forEach((s, i) => bin.set(s, starts[i]));
  const out = structuredClone(doc);
  for (const v of out.bufferViews ?? []) {
    v.byteOffset = (v.byteOffset ?? 0) + (starts[v.buffer] ?? 0);
    v.buffer = 0;
  }
  if (sources.length > 0) out.buffers = [{ byteLength: len }];
  else delete out.buffers;
  const chunks: GlbChunk[] = [{ type: CHUNK_JSON, data: new TextEncoder().encode(JSON.stringify(out)) }];
  if (sources.length > 0) chunks.push({ type: CHUNK_BIN, data: bin });
  return assembleGlb(chunks);
}

function parseDoc(json: unknown, supported: ReadonlySet<string> = NO_EXTENSIONS): GltfJson {
  let doc: GltfJson;
  try {
    doc = (typeof json === 'string' ? JSON.parse(json) : json) as GltfJson;
  } catch {
    throw new GltfError('The .gltf file is not valid JSON.');
  }
  if (!doc || typeof doc !== 'object') throw new GltfError('Not a glTF document.');
  const ver = doc.asset?.version;
  if (typeof ver !== 'string' || !ver.startsWith('2.')) throw new GltfError('Only glTF 2.0 is supported.');
  const required = (doc.extensionsRequired ?? []).filter((e) => !supported.has(e));
  if (required.some((e) => COMPRESSION_EXTENSIONS.has(e))) throw new GltfError(COMPRESSED_MESSAGE);
  if (required.length > 0) throw new GltfError(`Unsupported required extension: ${required.join(', ')}.`);
  return doc;
}

/** A compressed primitive with no plain fallback fails deep in the reader; name the real cause. */
function compressedGuard<T>(doc: GltfJson, read: () => T): T {
  try {
    return read();
  } catch (e) {
    if (e instanceof GltfError && (doc.extensionsUsed ?? []).some((x) => COMPRESSION_EXTENSIONS.has(x))) throw new GltfError(COMPRESSED_MESSAGE);
    throw e;
  }
}

/** Parse a `.gltf` document; `resources` holds external `.bin` files by URI or file name. */
export function parseGltf(json: unknown, resources: ReadonlyMap<string, ArrayBuffer>, opts: ImportOptions = DEFAULT_IMPORT, glbBin?: ArrayBuffer): GltfImport {
  const doc = parseDoc(json);
  return compressedGuard(doc, () => readDoc(doc, resources, opts, glbBin));
}

function readDoc(doc: GltfJson, resources: ReadonlyMap<string, ArrayBuffer>, opts: ImportOptions, glbBin?: ArrayBuffer): GltfImport {
  const warnings: string[] = [];
  const buffers = (doc.buffers ?? []).map((b, i) => loadBuffer(b, i, resources, glbBin));
  const { chunks, skipped } = collect(doc, buffers, false);
  if (skipped > 0) warnings.push(`Skipped ${skipped} point, line or position-less primitive${skipped === 1 ? '' : 's'}.`);
  return { mesh: toEnu(chunks, opts), warnings, scape: doc.asset?.extras?.scape };
}

interface WorldChunk {
  pos: Float64Array;
  idx: number[];
  feature?: Float64Array;
}

/** Every triangle primitive of the scene, through its node matrices, in the file's own axes. */
function collect(doc: GltfJson, buffers: ArrayBuffer[], quantized: boolean, draco?: DracoDecoder): { chunks: WorldChunk[]; skipped: number } {
  const chunks: WorldChunk[] = [];
  let skipped = 0;

  const nodes = doc.nodes ?? [];
  const visit = (n: number, parent: Float64Array, seen: Set<number>) => {
    const node = nodes[n];
    if (!node) throw new GltfError(`Node ${n} does not exist.`);
    if (seen.has(n)) throw new GltfError('Node hierarchy has a cycle.');
    seen.add(n);
    const m = mul(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = doc.meshes?.[node.mesh];
      if (!mesh) throw new GltfError(`Mesh ${node.mesh} does not exist.`);
      const flip = det3(m) < 0;
      for (const prim of mesh.primitives ?? []) {
        const mode = prim.mode ?? 4;
        if (mode < 4) {
          skipped++;
          continue;
        }
        if (mode > 6) throw new GltfError(`Primitive mode ${mode} is not valid.`);
        const posAcc = prim.attributes?.POSITION;
        if (posAcc === undefined) {
          skipped++;
          continue;
        }
        const ext = quantized ? prim.extensions?.KHR_draco_mesh_compression : undefined;
        if (ext) {
          const d = readDraco(doc, buffers, ext, draco);
          chunks.push({ pos: transform(d.pos, m), idx: triangulate(d.idx, mode, flip), feature: d.feature });
          continue;
        }
        const local = readPositions(doc, buffers, posAcc, quantized);
        const count = local.length / 3;
        const order = prim.indices === undefined ? Array.from({ length: count }, (_, i) => i) : readIndices(doc, buffers, prim.indices, count);
        const fid = prim.attributes[FEATURE_ID] ?? prim.attributes[BATCH_ID];
        const feature = quantized && fid !== undefined ? readFeatureIds(doc, buffers, fid, count) : undefined;
        chunks.push({ pos: transform(local, m), idx: triangulate(order, mode, flip), feature });
      }
    }
    for (const c of node.children ?? []) visit(c, m, seen);
    seen.delete(n);
  };
  const sceneIdx = doc.scene ?? 0;
  let roots: number[];
  if (doc.scenes?.length) {
    const scene = doc.scenes[sceneIdx];
    if (!scene) throw new GltfError(`Scene ${sceneIdx} does not exist.`);
    roots = scene.nodes ?? [];
  } else {
    const child = new Set(nodes.flatMap((n) => n.children ?? []));
    roots = nodes.map((_, i) => i).filter((i) => !child.has(i));
  }
  for (const r of roots) visit(r, IDENTITY, new Set());
  return { chunks, skipped };
}

export interface GltfWorld {
  /** Vertices in glTF axes after every node matrix, unrounded. */
  pos: Float64Array;
  idx: Uint32Array;
  /** `_FEATURE_ID_0` or `_BATCHID` per vertex; -1 where the primitive has none. */
  feature: Int32Array;
  /** `CESIUM_RTC` centre, added after the y-up turn. */
  rtc?: [number, number, number];
  doc: GltfJson;
  buffers: ArrayBuffer[];
}

/** Whether the GLB has Draco primitives, so the caller loads that decoder only when it must. */
export function gltfUsesDraco(buf: ArrayBuffer): boolean {
  const doc = readGlb(buf).json as GltfJson | undefined;
  return !!doc && [...(doc.extensionsUsed ?? []), ...(doc.extensionsRequired ?? [])].includes(DRACO);
}

/** A 3D Tiles GLB (meshopt or Draco, quantized) as one Float64 triangle soup with feature ids. */
export function readGlbWorld(buf: ArrayBuffer, decoders: WorldDecoders): GltfWorld {
  const { json, bin } = readGlb(buf);
  const doc = parseDoc(json, WORLD_EXTENSIONS);
  const buffers = (doc.buffers ?? []).map((b, i) => loadBuffer(b, i, new Map(), bin));
  decodeMeshopt(doc, buffers, decoders.meshopt);
  const { chunks } = collect(doc, buffers, true, decoders.draco);
  let nv = 0;
  let ni = 0;
  for (const c of chunks) {
    nv += c.pos.length / 3;
    ni += c.idx.length;
  }
  const pos = new Float64Array(nv * 3);
  const feature = new Int32Array(nv).fill(-1);
  const idx = new Uint32Array(ni);
  let base = 0;
  let at = 0;
  for (const c of chunks) {
    pos.set(c.pos, base * 3);
    if (c.feature) for (let i = 0; i < c.feature.length; i++) feature[base + i] = Math.round(c.feature[i]);
    for (const v of c.idx) idx[at++] = v + base;
    base += c.pos.length / 3;
  }
  const c = doc.extensions?.CESIUM_RTC?.center;
  const rtc = c?.length === 3 && c.every(Number.isFinite) ? ([c[0], c[1], c[2]] as [number, number, number]) : undefined;
  return { pos, idx, feature, rtc, doc, buffers };
}

/** One Draco primitive's positions, triangle list and feature ids. */
function readDraco(doc: GltfJson, buffers: ArrayBuffer[], ext: { bufferView: number; attributes: Record<string, number> }, decoder?: DracoDecoder): { pos: Float64Array; idx: number[]; feature?: Float64Array } {
  if (!decoder) throw new GltfError('Draco primitive needs the Draco decoder.');
  const bv = doc.bufferViews?.[ext.bufferView];
  const src = bv && buffers[bv.buffer];
  if (!bv || !src || (bv.byteOffset ?? 0) + bv.byteLength > src.byteLength) throw new GltfError(`Draco buffer view ${ext.bufferView} is not valid.`);
  const fidName = ext.attributes[FEATURE_ID] !== undefined ? FEATURE_ID : BATCH_ID;
  const want: Record<string, number> = {};
  if (ext.attributes.POSITION === undefined) throw new GltfError('Draco primitive has no POSITION.');
  want.POSITION = ext.attributes.POSITION;
  if (ext.attributes[fidName] !== undefined) want[fidName] = ext.attributes[fidName];
  let out: ReturnType<DracoDecoder['decode']>;
  try {
    out = decoder.decode(new Uint8Array(src, bv.byteOffset ?? 0, bv.byteLength), want);
  } catch (e) {
    throw new GltfError(`Draco data is not valid: ${e instanceof Error ? e.message : e}.`);
  }
  const p = out.attributes.POSITION;
  if (!p || p.length % 3 !== 0) throw new GltfError('Draco POSITION is not VEC3.');
  const count = p.length / 3;
  for (const i of out.indices) if (i >= count) throw new GltfError('Draco index out of range.');
  const f = out.attributes[fidName];
  if (f && f.length !== count) throw new GltfError(`${fidName} count does not match POSITION.`);
  return { pos: Float64Array.from(p), idx: Array.from(out.indices), feature: f && Float64Array.from(f) };
}

/** Replace each meshopt view with its decoded bytes, so accessors read it like any other view. */
function decodeMeshopt(doc: GltfJson, buffers: ArrayBuffer[], decoder: MeshoptDecoder): void {
  (doc.bufferViews ?? []).forEach((bv, i) => {
    const ext = bv.extensions?.EXT_meshopt_compression;
    if (!ext) return;
    const src = buffers[ext.buffer];
    const start = ext.byteOffset ?? 0;
    if (!src || start + ext.byteLength > src.byteLength) throw new GltfError(`Buffer view ${i} meshopt source runs past its buffer.`);
    const out = new Uint8Array(ext.count * ext.byteStride);
    try {
      decoder.decodeGltfBuffer(out, ext.count, ext.byteStride, new Uint8Array(src, start, ext.byteLength), ext.mode, ext.filter);
    } catch (e) {
      throw new GltfError(`Buffer view ${i} meshopt data is not valid: ${e instanceof Error ? e.message : e}.`);
    }
    bv.buffer = buffers.push(out.buffer) - 1;
    bv.byteOffset = 0;
    bv.byteLength = out.length;
    bv.byteStride = ext.mode === 'ATTRIBUTES' ? ext.byteStride : bv.byteStride;
  });
}

/** One `EXT_structural_metadata` property-table column: numbers (noData as NaN) or strings. */
export function propertyColumn(w: GltfWorld, table: number, name: string): (number | string)[] | undefined {
  const meta = w.doc.extensions?.EXT_structural_metadata;
  const t = meta?.propertyTables?.[table];
  const col = t?.properties?.[name];
  const def = t && meta?.schema?.classes?.[t.class]?.properties?.[name];
  if (!t || !col || !def) return undefined;
  const bytes = (v: number): DataView => {
    const bv = w.doc.bufferViews?.[v];
    const buf = bv && w.buffers[bv.buffer];
    if (!bv || !buf || (bv.byteOffset ?? 0) + bv.byteLength > buf.byteLength) throw new GltfError(`Property ${name} buffer view ${v} is not valid.`);
    return new DataView(buf, bv.byteOffset ?? 0, bv.byteLength);
  };
  const values = bytes(col.values);
  if (def.type === 'STRING') {
    if (col.stringOffsets === undefined) return undefined;
    const offs = bytes(col.stringOffsets);
    const ob = COMPONENT[STRUCT_COMPONENT[col.stringOffsetType ?? 'UINT32']];
    if (!ob || offs.byteLength < (t.count + 1) * ob.bytes) throw new GltfError(`Property ${name} string offsets are not valid.`);
    const dec = new TextDecoder();
    const u8 = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    return Array.from({ length: t.count }, (_, i) => dec.decode(u8.subarray(ob.get(offs, i * ob.bytes), ob.get(offs, (i + 1) * ob.bytes))));
  }
  const c = def.type === 'SCALAR' ? COMPONENT[STRUCT_COMPONENT[def.componentType ?? '']] : undefined;
  if (!c) return undefined;
  if (values.byteLength < t.count * c.bytes) throw new GltfError(`Property ${name} is shorter than its table.`);
  return Array.from({ length: t.count }, (_, i) => {
    const v = c.get(values, i * c.bytes);
    return v === def.noData || (def.noData !== undefined && Math.fround(v) === Math.fround(def.noData)) ? NaN : v;
  });
}

function loadBuffer(b: GltfBuffer, i: number, resources: ReadonlyMap<string, ArrayBuffer>, glbBin?: ArrayBuffer): ArrayBuffer {
  let data: ArrayBuffer | undefined;
  if (b.uri === undefined) {
    // A meshopt fallback holds nothing; its views are decoded into new buffers.
    if (b.extensions?.EXT_meshopt_compression?.fallback) return new ArrayBuffer(0);
    if (i !== 0 || !glbBin) throw new GltfError(`Buffer ${i} has no data.`);
    data = glbBin;
  } else if (b.uri.startsWith('data:')) {
    const comma = b.uri.indexOf(',');
    if (comma < 0 || !b.uri.slice(0, comma).endsWith(';base64')) throw new GltfError(`Buffer ${i} data URI is not base64.`);
    try {
      const s = atob(b.uri.slice(comma + 1));
      const out = new Uint8Array(s.length);
      for (let k = 0; k < s.length; k++) out[k] = s.charCodeAt(k);
      data = out.buffer;
    } catch {
      throw new GltfError(`Buffer ${i} data URI is not valid base64.`);
    }
  } else {
    const name = safeDecode(b.uri);
    data = resources.get(b.uri) ?? resources.get(name) ?? resources.get(name.slice(name.lastIndexOf('/') + 1));
    if (!data) throw new GltfError(`Missing ${name}; pick it together with the .gltf file.`);
  }
  if (data.byteLength < b.byteLength) throw new GltfError(`Buffer ${i} is shorter than its byteLength.`);
  return data;
}

function safeDecode(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

/** The accessor's view, bounds-checked against its buffer. */
function view(doc: GltfJson, buffers: ArrayBuffer[], a: number, elemBytes: number, what: string): { acc: GltfAccessor; dv: DataView; stride: number } {
  const acc = doc.accessors?.[a];
  if (!acc) throw new GltfError(`Accessor ${a} does not exist.`);
  if (acc.sparse) throw new GltfError('Sparse accessors are not supported.');
  if (acc.bufferView === undefined) throw new GltfError(`${what} accessor ${a} has no buffer view.`);
  const bv = doc.bufferViews?.[acc.bufferView];
  if (!bv) throw new GltfError(`Buffer view ${acc.bufferView} does not exist.`);
  const buf = buffers[bv.buffer];
  if (!buf) throw new GltfError(`Buffer ${bv.buffer} does not exist.`);
  const bvStart = bv.byteOffset ?? 0;
  if (bvStart + bv.byteLength > buf.byteLength) throw new GltfError(`Buffer view ${acc.bufferView} runs past its buffer.`);
  const stride = bv.byteStride ?? elemBytes;
  if (stride < elemBytes) throw new GltfError(`Buffer view ${acc.bufferView} stride is smaller than an element.`);
  const off = acc.byteOffset ?? 0;
  if (off > bv.byteLength) throw new GltfError(`Accessor ${a} starts past its buffer view.`);
  if (!Number.isInteger(acc.count) || acc.count < 0) throw new GltfError(`Accessor ${a} count is not valid.`);
  if (acc.count > 0 && off + stride * (acc.count - 1) + elemBytes > bv.byteLength) throw new GltfError(`Accessor ${a} runs past its buffer view.`);
  return { acc, dv: new DataView(buf, bvStart + off, Math.max(0, bv.byteLength - off)), stride };
}

interface Component {
  bytes: number;
  get: (dv: DataView, o: number) => number;
  /** The normalized divisor; signed values clamp at -1. */
  norm: number;
}

const COMPONENT: Record<number, Component> = {
  5120: { bytes: 1, get: (dv, o) => dv.getInt8(o), norm: 127 },
  5121: { bytes: 1, get: (dv, o) => dv.getUint8(o), norm: 255 },
  5122: { bytes: 2, get: (dv, o) => dv.getInt16(o, true), norm: 32767 },
  5123: { bytes: 2, get: (dv, o) => dv.getUint16(o, true), norm: 65535 },
  5125: { bytes: 4, get: (dv, o) => dv.getUint32(o, true), norm: 4294967295 },
  5126: { bytes: 4, get: (dv, o) => dv.getFloat32(o, true), norm: 1 },
  5130: { bytes: 8, get: (dv, o) => dv.getFloat64(o, true), norm: 1 },
  // Metadata only.
  5124: { bytes: 4, get: (dv, o) => dv.getInt32(o, true), norm: 2147483647 }
};

const STRUCT_COMPONENT: Record<string, number> = { INT8: 5120, UINT8: 5121, INT16: 5122, UINT16: 5123, INT32: 5124, UINT32: 5125, FLOAT32: 5126, FLOAT64: 5130 };

/** `comps` numbers per element, normalized when the accessor says so. */
function readNumbers(doc: GltfJson, buffers: ArrayBuffer[], a: number, comps: number, c: Component, what: string): Float64Array {
  const { acc, dv, stride } = view(doc, buffers, a, comps * c.bytes, what);
  const out = new Float64Array(acc.count * comps);
  const norm = acc.normalized && c.norm !== 1;
  for (let i = 0; i < acc.count; i++)
    for (let k = 0; k < comps; k++) {
      const v = c.get(dv, i * stride + k * c.bytes);
      out[i * comps + k] = norm ? Math.max(v / c.norm, -1) : v;
    }
  return out;
}

/** `quantized` also takes KHR_mesh_quantization's byte and short positions. */
function readPositions(doc: GltfJson, buffers: ArrayBuffer[], a: number, quantized: boolean): Float64Array {
  const acc = doc.accessors?.[a];
  const ok = quantized ? [5120, 5121, 5122, 5123, FLOAT] : [FLOAT];
  if (acc && (!ok.includes(acc.componentType) || acc.type !== 'VEC3')) throw new GltfError(quantized ? 'POSITION must be float, byte or short VEC3.' : 'POSITION must be FLOAT VEC3.');
  return readNumbers(doc, buffers, a, 3, COMPONENT[acc?.componentType ?? FLOAT], 'POSITION');
}

function readFeatureIds(doc: GltfJson, buffers: ArrayBuffer[], a: number, vertices: number): Float64Array {
  const acc = doc.accessors?.[a];
  if (!acc || ![5121, 5123, FLOAT].includes(acc.componentType) || acc.type !== 'SCALAR') throw new GltfError('_FEATURE_ID_0 must be ubyte, ushort or float SCALAR.');
  const out = readNumbers(doc, buffers, a, 1, COMPONENT[acc.componentType], 'Feature id');
  if (out.length !== vertices) throw new GltfError('_FEATURE_ID_0 count does not match POSITION.');
  return out;
}

function readIndices(doc: GltfJson, buffers: ArrayBuffer[], a: number, vertices: number): number[] {
  const acc = doc.accessors?.[a];
  const bytes = acc && acc.type === 'SCALAR' ? INDEX_BYTES[acc.componentType] : undefined;
  if (!bytes) throw new GltfError('Indices must be unsigned byte, short or int SCALAR.');
  const { acc: ac, dv } = view(doc, buffers, a, bytes, 'Index');
  const out = Array.from<number>({ length: ac.count });
  for (let i = 0; i < ac.count; i++) {
    const o = i * bytes;
    const v = bytes === 1 ? dv.getUint8(o) : bytes === 2 ? dv.getUint16(o, true) : dv.getUint32(o, true);
    if (v >= vertices) throw new GltfError(`Index ${v} is out of range (${vertices} vertices).`);
    out[i] = v;
  }
  return out;
}

/** Triangle list from mode 4/5/6, wound per the glTF spec; `flip` for mirrored nodes. */
function triangulate(v: number[], mode: number, flip: boolean): number[] {
  const out: number[] = [];
  const push = (a: number, b: number, c: number) => (flip ? out.push(a, c, b) : out.push(a, b, c));
  if (mode === 4) for (let i = 0; i + 2 < v.length; i += 3) push(v[i], v[i + 1], v[i + 2]);
  else if (mode === 5) for (let i = 0; i + 2 < v.length; i++) push(v[i], v[i + 1 + (i % 2)], v[i + 2 - (i % 2)]);
  else for (let i = 1; i + 1 < v.length; i++) push(v[i], v[i + 1], v[0]);
  return out;
}

const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Column-major, as glTF stores it. */
function localMatrix(n: GltfNode): Float64Array {
  if (n.matrix) {
    if (n.matrix.length !== 16) throw new GltfError('Node matrix must have 16 numbers.');
    return Float64Array.from(n.matrix);
  }
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  // T · R · S
  return new Float64Array([
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1
  ]);
}

function mul(a: Float64Array, b: Float64Array): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

function det3(m: Float64Array): number {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

function transform(p: Float64Array, m: Float64Array): Float64Array {
  const out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

/** Merge primitives into one local ENU mesh: units, axes and origin applied in Float64. */
function toEnu(chunks: { pos: Float64Array; idx: number[] }[], opts: ImportOptions): ModelMesh {
  const k = UNIT_M[opts.units];
  if (k === undefined) throw new GltfError(`Unknown unit ${opts.units}.`);
  let nv = 0;
  let ni = 0;
  for (const c of chunks) {
    nv += c.pos.length;
    ni += c.idx.length;
  }
  const p = new Float64Array(nv);
  const idx = new Uint32Array(ni);
  let base = 0;
  let at = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.pos.length; i += 3) {
      const x = c.pos[i] * k;
      const y = c.pos[i + 1] * k;
      const z = c.pos[i + 2] * k;
      const o = base * 3 + i;
      p[o] = x;
      p[o + 1] = opts.zUp ? y : 0 - z; // not -z: no -0
      p[o + 2] = opts.zUp ? z : y;
    }
    for (const v of c.idx) idx[at++] = v + base;
    base += c.pos.length / 3;
  }
  if (opts.origin === ModelOrigin.BaseCentre && idx.length > 0) {
    const b = box64(p, idx);
    const ce = (b[0] + b[3]) / 2;
    const cn = (b[1] + b[4]) / 2;
    for (let i = 0; i < p.length; i += 3) {
      p[i] -= ce;
      p[i + 1] -= cn;
      p[i + 2] -= b[2];
    }
  }
  const pos = Float32Array.from(p);
  return { pos, idx, box: Float32Array.from(box64(pos, idx)) };
}

/** Bounds of the vertices the triangles use. */
function box64(p: ArrayLike<number>, idx: Uint32Array): Float64Array {
  const b = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (const v of idx)
    for (let a = 0; a < 3; a++) {
      const x = p[v * 3 + a];
      if (x < b[a]) b[a] = x;
      if (x > b[a + 3]) b[a + 3] = x;
    }
  return idx.length > 0 ? b : new Float64Array(6);
}

export interface MeshStats {
  vertices: number;
  triangles: number;
  heightM: number;
  /** East–west extent. */
  widthM: number;
  /** North–south extent. */
  depthM: number;
}

export interface ValidMesh {
  mesh: ModelMesh;
  stats: MeshStats;
  /** Plan-view convex hull in local e, n; counter-clockwise. */
  hull: [e: number, n: number][];
  degenerate: number;
  warnings: string[];
}

/** Check and clean a mesh for placing: drops degenerate triangles and unused vertices; throws GltfError when unusable. */
export function validateMesh(mesh: ModelMesh): ValidMesh {
  const { pos, idx } = mesh;
  const nv = Math.floor(pos.length / 3);
  if (idx.length % 3 !== 0) throw new GltfError('Index count is not a multiple of 3.');
  const keep: number[] = [];
  let degenerate = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    if (a >= nv || b >= nv || c >= nv) throw new GltfError(`Index ${Math.max(a, b, c)} is out of range (${nv} vertices).`);
    for (const v of [a, b, c])
      if (!Number.isFinite(pos[v * 3]) || !Number.isFinite(pos[v * 3 + 1]) || !Number.isFinite(pos[v * 3 + 2])) throw new GltfError('Mesh has non-finite positions.');
    const ux = pos[b * 3] - pos[a * 3];
    const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
    const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3];
    const vy = pos[c * 3 + 1] - pos[a * 3 + 1];
    const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (a === b || b === c || a === c || cx * cx + cy * cy + cz * cz === 0) degenerate++;
    else keep.push(a, b, c);
  }
  const triangles = keep.length / 3;
  if (triangles === 0) throw new GltfError('The file has no triangles.');
  if (triangles > MAX_TRIANGLES) throw new GltfError(`The model has ${triangles.toLocaleString('en')} triangles; the limit is 500,000. Decimate it first.`);

  const remap = new Int32Array(nv).fill(-1);
  const out: number[] = [];
  const newIdx = new Uint32Array(keep.length);
  for (let i = 0; i < keep.length; i++) {
    const v = keep[i];
    if (remap[v] < 0) {
      remap[v] = out.length / 3;
      out.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    newIdx[i] = remap[v];
  }
  const newPos = Float32Array.from(out);
  const box = Float32Array.from(box64(newPos, newIdx));
  const widthM = box[3] - box[0];
  const depthM = box[4] - box[1];
  const heightM = box[5] - box[2];
  const warnings: string[] = [];
  if (degenerate > 0) warnings.push(`Dropped ${degenerate} degenerate triangle${degenerate === 1 ? '' : 's'}.`);
  const largest = Math.max(widthM, depthM, heightM);
  if (largest < 1) warnings.push('The model is under 1 m across; check the units.');
  else if (largest > 2000) warnings.push('The model is over 2 km across; check the units.');
  const plan: [number, number][] = [];
  for (let i = 0; i < out.length; i += 3) plan.push([newPos[i], newPos[i + 1]]);
  return {
    mesh: { pos: newPos, idx: newIdx, box },
    stats: { vertices: newPos.length / 3, triangles, heightM, widthM, depthM },
    hull: convexHull(plan),
    degenerate,
    warnings
  };
}

/** A GLB of the mesh in glTF axes (x = E, y = U, z = −N), with `extras` as `asset.extras.scape`. */
export function writeGlb(mesh: ModelMesh, extras: unknown): ArrayBuffer {
  const nv = mesh.pos.length / 3;
  const file = new Float32Array(mesh.pos.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.pos.length; i += 3) {
    file[i] = mesh.pos[i];
    file[i + 1] = mesh.pos[i + 2];
    file[i + 2] = 0 - mesh.pos[i + 1];
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], file[i + a]);
      max[a] = Math.max(max[a], file[i + a]);
    }
  }
  const posBytes = file.byteLength;
  const binLen = posBytes + mesh.idx.byteLength;
  const doc = {
    asset: { version: '2.0', generator: 'Scape', extras: { scape: extras } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: FLOAT, count: nv, type: 'VEC3', ...(nv > 0 ? { min, max } : {}) },
      { bufferView: 1, componentType: 5125, count: mesh.idx.length, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: mesh.idx.byteLength, target: 34963 }
    ],
    buffers: [{ byteLength: binLen }]
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(doc));
  const jsonLen = pad4(jsonBytes.length);
  const binPadded = pad4(binLen);
  const total = 12 + 8 + jsonLen + 8 + binPadded;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, CHUNK_JSON, true);
  u8.set(jsonBytes, 20);
  u8.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  const binAt = 20 + jsonLen;
  dv.setUint32(binAt, binPadded, true);
  dv.setUint32(binAt + 4, CHUNK_BIN, true);
  u8.set(new Uint8Array(file.buffer, file.byteOffset, posBytes), binAt + 8);
  u8.set(new Uint8Array(mesh.idx.buffer, mesh.idx.byteOffset, mesh.idx.byteLength), binAt + 8 + posBytes);
  return out;
}

const pad4 = (n: number) => (n + 3) & ~3;
