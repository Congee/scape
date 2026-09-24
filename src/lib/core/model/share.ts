/** Sharing precise models: placement in `asset.extras.scape`, picked files as drafts, and `.scape.json` records. */

import { AltitudeRef, localToLngLat, ModelSource, partsFootprint, type ModelAnchor, type ModelPart, type SavedModel } from '@core/model';
import { RoofShape } from '@workers/buildings.protocol';
import { DEFAULT_IMPORT, GltfError, ModelOrigin, ModelUnit, packGltf, parseGlb, readGlb, replaceGlbJson, validateMesh, writeGlb, type ImportOptions, type MeshStats } from './gltf';
import { partsMesh } from './mesh';

/** What `asset.extras.scape` carries, decoded. */
export interface ScapeExtras {
  anchor: ModelAnchor;
  footprint: [lng: number, lat: number][];
  parts?: ModelPart[];
  importOptions?: ImportOptions;
}

/** A Drawn model's mesh is written in metres, glTF axes, in the anchor's frame. */
const DRAWN_OPTIONS: ImportOptions = { units: ModelUnit.M, zUp: false, origin: ModelOrigin.Keep };

/** JSON-safe extras: a NaN roof direction becomes null. */
export function encodeExtras(m: Pick<SavedModel, 'source' | 'anchor' | 'footprint' | 'parts' | 'importOptions'>, withParts = true): unknown {
  const drawn = m.source === ModelSource.Drawn;
  return {
    anchor: m.anchor,
    footprint: m.footprint,
    ...(withParts && m.parts ? { parts: m.parts.map((p) => ({ ...p, roofDirDeg: Number.isNaN(p.roofDirDeg) ? null : p.roofDirDeg })) } : {}),
    importOptions: drawn ? DRAWN_OPTIONS : (m.importOptions ?? DEFAULT_IMPORT)
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const isRing = (v: unknown): v is [number, number][] => Array.isArray(v) && v.every(isPair);
const oneOf = <T>(o: Record<string, T>, v: unknown): v is T => Object.values(o).includes(v as T);
const pairs = (r: [number, number][]): [number, number][] => r.map(([a, b]) => [a, b]);

function decodeAnchor(v: unknown): ModelAnchor | null {
  const a = v as Record<string, unknown> | null;
  if (!a || !isNum(a.lat) || !isNum(a.lng) || !oneOf(AltitudeRef, a.altRef) || !isNum(a.altM) || !isNum(a.headingDeg) || !isNum(a.scale) || !(a.scale > 0)) return null;
  return { lat: a.lat, lng: a.lng, altRef: a.altRef, altM: a.altM, headingDeg: a.headingDeg, scale: a.scale };
}

function decodePart(v: unknown): ModelPart | null {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p.id !== 'string' || !isRing(p.ring) || !isNum(p.baseM) || !isNum(p.heightM) || !oneOf(RoofShape, p.roof) || !isNum(p.roofHeightM)) return null;
  if (!(p.roofDirDeg === null || isNum(p.roofDirDeg)) || !(p.roofAcross === 0 || p.roofAcross === 1)) return null;
  return { id: p.id, ring: pairs(p.ring), baseM: p.baseM, heightM: p.heightM, roof: p.roof, roofHeightM: p.roofHeightM, roofDirDeg: p.roofDirDeg ?? NaN, roofAcross: p.roofAcross };
}

function decodeOptions(v: unknown): ImportOptions | null {
  const o = v as Record<string, unknown> | null;
  if (!o || !oneOf(ModelUnit, o.units) || typeof o.zUp !== 'boolean' || !oneOf(ModelOrigin, o.origin)) return null;
  return { units: o.units, zUp: o.zUp, origin: o.origin };
}

/** Checked extras, or null when absent or malformed. */
export function decodeExtras(v: unknown): ScapeExtras | null {
  const x = v as Record<string, unknown> | null;
  if (!x || typeof x !== 'object') return null;
  const anchor = decodeAnchor(x.anchor);
  if (!anchor || !isRing(x.footprint)) return null;
  const out: ScapeExtras = { anchor, footprint: pairs(x.footprint) };
  if (x.parts !== undefined) {
    if (!Array.isArray(x.parts)) return null;
    const parts = x.parts.map(decodePart);
    if (parts.some((p) => !p)) return null;
    out.parts = parts as ModelPart[];
  }
  if (x.importOptions !== undefined) {
    const o = decodeOptions(x.importOptions);
    if (!o) return null;
    out.importOptions = o;
  }
  return out;
}

const scapeOf = (json: unknown): unknown => (json as { asset?: { extras?: { scape?: unknown } } } | null)?.asset?.extras?.scape;

/** A GLB of the model with its placement; a Drawn one is meshed from its parts, an Imported one keeps its bytes. */
export function exportModelGlb(m: SavedModel, withParts = true): ArrayBuffer {
  const extras = encodeExtras(m, withParts);
  if (m.source === ModelSource.Drawn) {
    if (!m.parts) throw new GltfError('This model has no parts to export.');
    return writeGlb(partsMesh(m.parts), extras);
  }
  if (!m.glb) throw new GltfError('This model has no mesh to export.');
  const doc = readGlb(m.glb).json as { asset?: { extras?: object } };
  return replaceGlbJson(m.glb, { ...doc, asset: { ...doc.asset, extras: { ...doc.asset?.extras, scape: extras } } });
}

/** Suggested download name. */
export function modelFileName(m: Pick<SavedModel, 'name'>): string {
  const base = m.name.trim().replace(/[^\p{L}\p{N} ._()-]+/gu, '_') || 'model';
  return `${base}.glb`;
}

/** A model before it has a place: `anchor` is null unless the file carried Scape extras. */
export type ModelDraft = Omit<SavedModel, 'anchor'> & { anchor: ModelAnchor | null };

export interface ModelImport {
  draft: ModelDraft;
  /** Plan-view convex hull in local e, n; the footprint once placed. */
  hull: [e: number, n: number][];
  stats: MeshStats;
  warnings: string[];
}

export type ModelFile = Pick<File, 'name' | 'arrayBuffer'>;

const GLB_MAGIC = 0x46546c67;
const isGlbBytes = (b: ArrayBuffer) => b.byteLength >= 4 && new DataView(b).getUint32(0, true) === GLB_MAGIC;
const ext = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

/** One GLB from a picked `.glb`, a `.gltf` with data: URIs, or a `.gltf` plus its `.bin` files. */
async function toGlb(input: readonly ModelFile[] | ArrayBuffer): Promise<{ glb: ArrayBuffer; name: string }> {
  if (input instanceof ArrayBuffer) return { glb: isGlbBytes(input) ? input : packGltf(new TextDecoder().decode(input), new Map()), name: 'Model' };
  const main = input.filter((f) => ext(f.name) === 'glb' || ext(f.name) === 'gltf');
  if (main.length === 0) throw new GltfError('Pick a .glb or .gltf file.');
  if (main.length > 1) throw new GltfError('Pick one model at a time.');
  const [file] = main;
  const name = file.name.slice(0, file.name.lastIndexOf('.')) || 'Model';
  const bytes = await file.arrayBuffer();
  if (ext(file.name) === 'glb' || isGlbBytes(bytes)) return { glb: bytes, name };
  const resources = new Map<string, ArrayBuffer>();
  for (const f of input) if (f !== file) resources.set(f.name, await f.arrayBuffer());
  return { glb: packGltf(new TextDecoder().decode(bytes), resources), name };
}

const hullFootprint = (anchor: ModelAnchor, hull: readonly [number, number][]): [number, number][] =>
  hull.map(([e, n]) => {
    const g = localToLngLat(anchor, e, n);
    return [g.lng, g.lat];
  });

/**
 * A draft model and its stats from picked files; throws GltfError when unusable. `opts` overrides the
 * file's own Scape import options. Scape extras with parts come back as a Drawn model.
 */
export async function importModelFile(input: readonly ModelFile[] | ArrayBuffer, opts?: ImportOptions, now = Date.now()): Promise<ModelImport> {
  const { glb, name } = await toGlb(input);
  const raw = scapeOf(readGlb(glb).json);
  const extras = decodeExtras(raw);
  const warnings: string[] = [];
  if (raw !== undefined && !extras) warnings.push('Ignored the Scape placement in the file: it is not valid.');
  const options = opts ?? extras?.importOptions ?? DEFAULT_IMPORT;
  const parts = extras?.parts;
  const parsed = parts ? null : parseGlb(glb, options);
  const v = validateMesh(parsed ? parsed.mesh : partsMesh(parts ?? []));
  warnings.push(...(parsed?.warnings ?? []), ...v.warnings);
  const anchor = extras?.anchor ?? null;
  const footprint = extras?.footprint ?? [];
  const common = { id: crypto.randomUUID(), name, anchor, footprint, groundM: NaN, suppressOverture: true, visible: true, attribution: '', notes: '', createdAt: now, updatedAt: now };
  const draft: ModelDraft = parts
    ? { ...common, source: ModelSource.Drawn, parts }
    : { ...common, source: ModelSource.Imported, glb, importOptions: options };
  return { draft, hull: v.hull, stats: v.stats, warnings };
}

/** The draft stood at `anchor`, its footprint re-derived there. */
export function placeDraft(imp: ModelImport, anchor: ModelAnchor): SavedModel {
  const { draft } = imp;
  return { ...draft, anchor, footprint: draft.parts ? partsFootprint(anchor, draft.parts) : hullFootprint(anchor, imp.hull) };
}

/** A model in a `.scape.json` export: placement and parts live in the GLB's extras. */
export interface ScapeModelRecord {
  id: string;
  name: string;
  source: ModelSource;
  /** JSON has no NaN. */
  groundM: number | null;
  suppressOverture: boolean;
  visible: boolean;
  attribution: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  /** Base64 GLB from `exportModelGlb`. */
  glb: string;
}

export function modelRecord(m: SavedModel): ScapeModelRecord {
  return {
    id: m.id,
    name: m.name,
    source: m.source,
    groundM: Number.isNaN(m.groundM) ? null : m.groundM,
    suppressOverture: m.suppressOverture,
    visible: m.visible,
    attribution: m.attribution,
    notes: m.notes,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    glb: toBase64(exportModelGlb(m, true))
  };
}

export function isModelRecord(v: unknown): v is ScapeModelRecord {
  const r = v as Partial<ScapeModelRecord> | null;
  return !!r && typeof r.id === 'string' && typeof r.name === 'string' && oneOf(ModelSource, r.source) && typeof r.glb === 'string';
}

/** The saved model a record holds; throws GltfError when its GLB lacks a valid placement. */
export function fromModelRecord(r: ScapeModelRecord): SavedModel {
  const glb = fromBase64(r.glb);
  const x = decodeExtras(scapeOf(readGlb(glb).json));
  if (!x) throw new GltfError(`Model “${r.name}” has no valid Scape placement.`);
  if (r.source === ModelSource.Drawn && !x.parts) throw new GltfError(`Model “${r.name}” has no parts.`);
  const base = {
    id: r.id,
    name: r.name,
    anchor: x.anchor,
    footprint: x.footprint,
    groundM: r.groundM ?? NaN,
    suppressOverture: r.suppressOverture,
    visible: r.visible,
    attribution: r.attribution,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
  return r.source === ModelSource.Drawn
    ? { ...base, source: ModelSource.Drawn, parts: x.parts }
    : { ...base, source: ModelSource.Imported, glb, importOptions: x.importOptions ?? DEFAULT_IMPORT };
}

export function toBase64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = '';
  // Chunked: spreading a huge array into fromCharCode overflows the stack.
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): ArrayBuffer {
  let s: string;
  try {
    s = atob(b64);
  } catch {
    throw new GltfError('Model data is not valid base64.');
  }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}
