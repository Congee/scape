// oxlint-disable no-await-in-loop, no-underscore-dangle -- each read depends on the last; _FillValue is HDF5's name
/**
 * A small read-only HDF5 reader: enough to pull one gridded dataset and its attributes out of a large file
 * without loading it whole. Superblock v0–v3, object headers v1/v2, symbol-table and compact groups,
 * contiguous and chunked layouts (v1 B-tree, single, implicit and fixed-array indexes), deflate/shuffle/fletcher32.
 */

export interface H5Source {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export const blobSource = (b: Blob): H5Source => ({ size: b.size, read: async (o, n) => new Uint8Array(await b.slice(o, o + n).arrayBuffer()) });
export const bytesSource = (b: Uint8Array): H5Source => ({ size: b.length, read: async (o, n) => b.subarray(o, Math.min(b.length, o + n)) });

export const H5Class = { Fixed: 0, Float: 1, String: 3 } as const;
export type H5Class = (typeof H5Class)[keyof typeof H5Class];

export interface H5Type {
  cls: H5Class;
  size: number;
  signed: boolean;
  bigEndian: boolean;
}

export type H5Value = number | string | number[];
export type H5Array = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

export interface H5Dataset {
  shape: number[];
  type: H5Type;
  attrs: Record<string, H5Value>;
  read(): Promise<H5Array>;
}

const SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const PAGE = 1 << 16;
const Msg = { Dataspace: 1, LinkInfo: 2, Datatype: 3, Layout: 8, Link: 6, Filters: 11, Attribute: 12, Continuation: 16, SymbolTable: 17 } as const;
const Filter = { Deflate: 1, Shuffle: 2, Fletcher32: 3 } as const;
const Chunks = { Single: 1, Implicit: 2, FixedArray: 3 } as const;

class Reader {
  private pages = new Map<number, Promise<Uint8Array>>();
  O = 8;
  L = 8;
  base = 0;
  constructor(readonly src: H5Source) {}

  private page(i: number): Promise<Uint8Array> {
    let p = this.pages.get(i);
    if (!p) {
      p = this.src.read(i * PAGE, PAGE);
      this.pages.set(i, p);
    }
    return p;
  }

  /** Metadata bytes through a page cache; `abs` skips the base address. */
  async bytes(at: number, n: number, abs = false): Promise<Uint8Array> {
    const o = abs ? at : at + this.base;
    if (o < 0 || o + n > this.src.size) throw new Error('Damaged HDF5 file: a structure points past the end of the file.');
    const first = Math.floor(o / PAGE);
    const last = Math.floor((o + n - 1) / PAGE);
    if (first === last) return (await this.page(first)).subarray(o - first * PAGE, o - first * PAGE + n);
    const out = new Uint8Array(n);
    for (let i = first; i <= last; i++) {
      const pg = await this.page(i);
      const s = Math.max(o, i * PAGE);
      const e = Math.min(o + n, i * PAGE + pg.length);
      out.set(pg.subarray(s - i * PAGE, e - i * PAGE), s - o);
    }
    return out;
  }

  /** Bulk chunk bytes, straight from the source. */
  raw(at: number, n: number): Promise<Uint8Array> {
    return this.src.read(at + this.base, n);
  }
}

/** A cursor over one parsed buffer. */
class Cur {
  dv: DataView;
  constructor(
    readonly b: Uint8Array,
    public p: number,
    readonly r: Reader
  ) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8 = () => this.b[this.p++];
  u16 = () => ((this.p += 2), this.dv.getUint16(this.p - 2, true));
  u32 = () => ((this.p += 4), this.dv.getUint32(this.p - 4, true));
  uN(n: number): number {
    let v = 0;
    let undef = true;
    for (let i = 0; i < n; i++) if (this.b[this.p + i] !== 0xff) undef = false;
    for (let i = n - 1; i >= 0; i--) v = v * 256 + this.b[this.p + i];
    this.p += n;
    return undef ? -1 : v;
  }
  /** An address; -1 for HDF5's undefined address. */
  addr = () => this.uN(this.r.O);
  len = () => this.uN(this.r.L);
  skip(n: number) {
    this.p += n;
    return this;
  }
  sig(s: string) {
    const got = String.fromCharCode(...this.b.subarray(this.p, this.p + 4));
    if (got !== s) throw new Error(`Damaged HDF5 file: expected ${s}, found ${JSON.stringify(got)}.`);
    this.p += 4;
  }
  cstr(): string {
    let e = this.p;
    while (e < this.b.length && this.b[e] !== 0) e++;
    const s = new TextDecoder().decode(this.b.subarray(this.p, e));
    this.p = e + 1;
    return s;
  }
}

interface Message {
  type: number;
  data: Uint8Array;
}

async function readHeader(r: Reader, at: number): Promise<Message[]> {
  const head = await r.bytes(at, 16);
  const out: Message[] = [];
  const blocks: { at: number; n: number; v2: boolean; first: boolean }[] = [];
  let v2 = false;
  let track = false;
  if (head[0] === 1) {
    const c = new Cur(head, 8, r);
    blocks.push({ at: at + 16, n: c.u32(), v2: false, first: true });
  } else {
    new Cur(head, 0, r).sig('OHDR');
    if (head[4] !== 2) throw new Error(`HDF5 object header version ${head[4]} is not supported.`);
    v2 = true;
    const flags = head[5];
    track = (flags & 4) !== 0;
    const pre = 6 + (flags & 0x20 ? 16 : 0) + (flags & 0x10 ? 4 : 0);
    const sz = 1 << (flags & 3);
    const c = new Cur(await r.bytes(at + pre, sz), 0, r);
    const n = c.uN(sz);
    blocks.push({ at: at + pre + sz, n, v2: true, first: true });
  }
  while (blocks.length) {
    const blk = blocks.shift()!;
    const b = await r.bytes(blk.at, blk.n);
    const c = new Cur(b, 0, r);
    let end = blk.n;
    // Chunk 0's size excludes its checksum; a continuation's length covers signature and checksum.
    if (blk.v2 && !blk.first) {
      c.sig('OCHK');
      end -= 4;
    }
    while (c.p + (v2 ? 4 : 8) <= end) {
      let type: number;
      let size: number;
      if (v2) {
        type = c.u8();
        size = c.u16();
        c.skip(1 + (track ? 2 : 0));
      } else {
        type = c.u16();
        size = c.u16();
        c.skip(4);
      }
      const data = b.subarray(c.p, c.p + size);
      c.skip(size);
      if (type === Msg.Continuation) {
        const cc = new Cur(data, 0, r);
        blocks.push({ at: cc.addr(), n: cc.len(), v2, first: false });
      } else out.push({ type, data });
    }
  }
  return out;
}

function parseType(c: Cur): H5Type {
  const cv = c.u8();
  const bits = c.u8();
  c.skip(2);
  const size = c.u32();
  const cls = cv & 15;
  if (cls === H5Class.Fixed || cls === H5Class.Float) {
    c.skip(cls === H5Class.Fixed ? 4 : 12);
    return { cls, size, signed: (bits & 8) !== 0, bigEndian: (bits & 1) !== 0 };
  }
  if (cls === H5Class.String) return { cls, size, signed: false, bigEndian: false };
  return { cls: cls as H5Class, size, signed: false, bigEndian: false };
}

function parseSpace(c: Cur): number[] {
  const v = c.u8();
  const rank = c.u8();
  c.skip(v === 1 ? 6 : 2);
  const dims: number[] = [];
  for (let i = 0; i < rank; i++) dims.push(c.len());
  return dims;
}

function decodeValues(b: Uint8Array, t: H5Type, count: number): H5Array {
  const ctor = arrayCtor(t);
  const out = new ctor(count);
  if (!t.bigEndian && b.byteOffset % t.size === 0) {
    out.set(new ctor(b.buffer as ArrayBuffer, b.byteOffset, count) as never);
    return out;
  }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const le = !t.bigEndian;
  const get = getter(dv, t);
  for (let i = 0; i < count; i++) out[i] = get(i * t.size, le);
  return out;
}

function getter(dv: DataView, t: H5Type): (at: number, le: boolean) => number {
  if (t.cls === H5Class.Float) return t.size === 4 ? (a, le) => dv.getFloat32(a, le) : (a, le) => dv.getFloat64(a, le);
  switch (t.size) {
    case 1:
      return t.signed ? (a) => dv.getInt8(a) : (a) => dv.getUint8(a);
    case 2:
      return t.signed ? (a, le) => dv.getInt16(a, le) : (a, le) => dv.getUint16(a, le);
    case 4:
      return t.signed ? (a, le) => dv.getInt32(a, le) : (a, le) => dv.getUint32(a, le);
  }
  throw new Error(`HDF5 integers of ${t.size} bytes are not supported.`);
}

function arrayCtor(t: H5Type) {
  if (t.cls === H5Class.Float) {
    if (t.size === 4) return Float32Array;
    if (t.size === 8) return Float64Array;
  } else if (t.cls === H5Class.Fixed) {
    if (t.size === 1) return t.signed ? Int8Array : Uint8Array;
    if (t.size === 2) return t.signed ? Int16Array : Uint16Array;
    if (t.size === 4) return t.signed ? Int32Array : Uint32Array;
  }
  throw new Error(`HDF5 datatype class ${t.cls} of ${t.size} bytes is not supported.`);
}

function parseAttr(m: Uint8Array, r: Reader): [string, H5Value] | null {
  const c = new Cur(m, 0, r);
  const v = c.u8();
  c.skip(1);
  const nameN = c.u16();
  const typeN = c.u16();
  const spaceN = c.u16();
  if (v === 3) c.skip(1);
  const pad = (n: number) => (v === 1 ? Math.ceil(n / 8) * 8 : n);
  const name = new TextDecoder().decode(m.subarray(c.p, c.p + nameN - 1));
  c.skip(pad(nameN));
  const t = parseType(new Cur(m, c.p, r));
  c.skip(pad(typeN));
  const dims = parseSpace(new Cur(m, c.p, r));
  c.skip(pad(spaceN));
  const count = dims.reduce((a, d) => a * d, 1);
  const data = m.subarray(c.p, c.p + count * t.size);
  if (t.cls === H5Class.String) {
    const s = data.subarray(0, t.size);
    let e = s.indexOf(0);
    if (e < 0) e = s.length;
    return [name, new TextDecoder().decode(s.subarray(0, e)).trim()];
  }
  if (t.cls !== H5Class.Fixed && t.cls !== H5Class.Float) return null;
  try {
    const vals = Array.from(decodeValues(data.slice(), t, count));
    return [name, dims.length === 0 || count === 1 ? vals[0] : vals];
  } catch {
    return null;
  }
}

function attrsOf(msgs: Message[], r: Reader): Record<string, H5Value> {
  const out: Record<string, H5Value> = {};
  for (const m of msgs)
    if (m.type === Msg.Attribute) {
      const a = parseAttr(m.data, r);
      if (a) out[a[0]] = a[1];
    }
  return out;
}

async function heapName(r: Reader, heap: number, off: number): Promise<string> {
  const h = new Cur(await r.bytes(heap, 8 + 2 * r.L + r.O), 0, r);
  h.sig('HEAP');
  h.skip(4);
  const size = h.len();
  h.len();
  const data = h.addr();
  return new Cur(await r.bytes(data + off, Math.min(256, size - off)), 0, r).cstr();
}

/** Child object header address by name in a symbol-table group; walks the v1 B-tree. */
async function symbolChild(r: Reader, btree: number, heap: number, name: string): Promise<number> {
  const node = new Cur(await r.bytes(btree, 8 + 2 * r.O), 0, r);
  node.sig('TREE');
  node.u8();
  const level = node.u8();
  const used = node.u16();
  const body = new Cur(await r.bytes(btree + 8 + 2 * r.O, (used + 1) * r.L + used * r.O), 0, r);
  const children: number[] = [];
  for (let i = 0; i < used; i++) {
    body.len();
    children.push(body.addr());
  }
  for (const ch of children) {
    if (level > 0) {
      const got = await symbolChild(r, ch, heap, name);
      if (got >= 0) return got;
      continue;
    }
    const sn = new Cur(await r.bytes(ch, 8), 0, r);
    sn.sig('SNOD');
    sn.skip(2);
    const n = sn.u16();
    const entry = 2 * r.O + 24;
    const es = new Cur(await r.bytes(ch + 8, n * entry), 0, r);
    for (let i = 0; i < n; i++) {
      es.p = i * entry;
      const nameOff = es.len();
      const hdr = es.addr();
      if ((await heapName(r, heap, nameOff)) === name) return hdr;
    }
  }
  return -1;
}

function linkTarget(m: Uint8Array, r: Reader): { name: string; addr: number } | null {
  const c = new Cur(m, 0, r);
  c.u8();
  const flags = c.u8();
  const type = flags & 8 ? c.u8() : 0;
  if (flags & 4) c.skip(8);
  if (flags & 16) c.skip(1);
  const n = c.uN(1 << (flags & 3));
  const name = new TextDecoder().decode(m.subarray(c.p, c.p + n));
  c.skip(n);
  return type === 0 ? { name, addr: c.addr() } : null;
}

async function child(r: Reader, msgs: Message[], name: string): Promise<number> {
  for (const m of msgs) {
    if (m.type === Msg.SymbolTable) {
      const c = new Cur(m.data, 0, r);
      const bt = c.addr();
      return symbolChild(r, bt, c.addr(), name);
    }
    if (m.type === Msg.Link) {
      const l = linkTarget(m.data, r);
      if (l?.name === name) return l.addr;
    }
  }
  for (const m of msgs)
    if (m.type === Msg.LinkInfo) {
      const c = new Cur(m.data, 0, r);
      c.u8();
      if (c.u8() & 1) c.skip(8);
      if (c.addr() >= 0) throw new Error('HDF5 dense (fractal-heap) groups are not supported.');
    }
  return -1;
}

interface Pipe {
  id: number;
  values: number[];
}

function parseFilters(m: Uint8Array, r: Reader): Pipe[] {
  const c = new Cur(m, 0, r);
  const v = c.u8();
  const n = c.u8();
  if (v === 1) c.skip(6);
  const out: Pipe[] = [];
  for (let i = 0; i < n; i++) {
    const id = c.u16();
    const nameN = v === 1 || id >= 256 ? c.u16() : 0;
    c.u16();
    const nv = c.u16();
    c.skip(v === 1 ? Math.ceil(nameN / 8) * 8 : nameN);
    const values: number[] = [];
    for (let k = 0; k < nv; k++) values.push(c.u32());
    if (v === 1 && nv % 2) c.skip(4);
    out.push({ id, values });
  }
  return out;
}

async function unfilter(b: Uint8Array, pipe: Pipe[], mask: number): Promise<Uint8Array> {
  for (let i = pipe.length - 1; i >= 0; i--) {
    if (mask & (1 << i)) continue;
    const f = pipe[i];
    if (f.id === Filter.Deflate) {
      const s = new Blob([b as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
      b = new Uint8Array(await new Response(s).arrayBuffer());
    } else if (f.id === Filter.Shuffle) {
      const es = f.values[0] ?? 1;
      const n = Math.floor(b.length / es);
      const o = new Uint8Array(b.length);
      for (let k = 0; k < es; k++) for (let j = 0; j < n; j++) o[j * es + k] = b[k * n + j];
      o.set(b.subarray(n * es), n * es);
      b = o;
    } else if (f.id === Filter.Fletcher32) b = b.subarray(0, b.length - 4);
    else throw new Error(`HDF5 filter ${f.id} is not supported (only deflate, shuffle and fletcher32).`);
  }
  return b;
}

interface Chunk {
  offset: number[];
  addr: number;
  size: number;
  mask: number;
}

async function btreeChunks(r: Reader, at: number, rank: number, out: Chunk[]): Promise<void> {
  const head = new Cur(await r.bytes(at, 8 + 2 * r.O), 0, r);
  head.sig('TREE');
  head.u8();
  const level = head.u8();
  const used = head.u16();
  const key = 8 + 8 * (rank + 1);
  const c = new Cur(await r.bytes(at + 8 + 2 * r.O, (used + 1) * key + used * r.O), 0, r);
  for (let i = 0; i < used; i++) {
    const size = c.u32();
    const mask = c.u32();
    const offset: number[] = [];
    for (let d = 0; d <= rank; d++) offset.push(c.uN(8));
    const addr = c.addr();
    if (level > 0) await btreeChunks(r, addr, rank, out);
    else out.push({ offset: offset.slice(0, rank), addr, size, mask });
  }
}

/** Chunk offsets in row-major grid order, for the implicit and fixed-array indexes. */
function gridOffsets(shape: number[], chunk: number[]): number[][] {
  const n = shape.map((s, i) => Math.ceil(s / chunk[i]));
  const out: number[][] = [];
  const idx = n.map(() => 0);
  const total = n.reduce((a, b) => a * b, 1);
  for (let k = 0; k < total; k++) {
    out.push(idx.map((v, i) => v * chunk[i]));
    for (let d = n.length - 1; d >= 0; d--) {
      if (++idx[d] < n[d]) break;
      idx[d] = 0;
    }
  }
  return out;
}

async function fixedArrayChunks(r: Reader, at: number, shape: number[], chunk: number[], bytes: number, filtered: boolean): Promise<Chunk[]> {
  const h = new Cur(await r.bytes(at, 12 + r.L + r.O), 0, r);
  h.sig('FAHD');
  h.skip(2);
  const entry = h.u8();
  const pageBits = h.u8();
  const count = h.len();
  const block = h.addr();
  const offs = gridOffsets(shape, chunk);
  const perPage = 2 ** pageBits;
  const pages = count > perPage ? Math.ceil(count / perPage) : 0;
  let p = block + 6 + r.O + (pages ? Math.ceil(pages / 8) : 0) + 4;
  const dhead = new Cur(await r.bytes(block, 4), 0, r);
  dhead.sig('FADB');
  if (!pages) p -= 4;
  const out: Chunk[] = [];
  for (let i = 0; i < count; ) {
    const n = pages ? Math.min(perPage, count - i) : count;
    const c = new Cur(await r.bytes(p, n * entry), 0, r);
    for (let k = 0; k < n; k++, i++) {
      const addr = c.addr();
      const size = filtered ? c.uN(entry - r.O - 4) : bytes;
      const mask = filtered ? c.u32() : 0;
      out.push({ offset: offs[i], addr, size, mask });
    }
    p += n * entry + 4;
  }
  return out;
}

interface Layout {
  cls: number;
  /** File address; for a compact layout, the data's offset inside the message. */
  addr: number;
  size: number;
  chunk: number[];
  index: number;
  single?: { size: number; mask: number };
}

function parseLayout(m: Uint8Array, r: Reader, rank: number): Layout {
  const c = new Cur(m, 0, r);
  const v = c.u8();
  if (v < 3) throw new Error(`HDF5 layout message version ${v} is not supported.`);
  const cls = c.u8();
  if (cls === 0) {
    return { cls, addr: c.p + 2, size: c.u16(), chunk: [], index: 0 };
  }
  if (cls === 1) return { cls, addr: c.addr(), size: c.len(), chunk: [], index: 0 };
  if (cls !== 2) throw new Error(`HDF5 layout class ${cls} is not supported.`);
  if (v === 3) {
    const dim = c.u8();
    const addr = c.addr();
    const chunk: number[] = [];
    for (let i = 0; i < dim; i++) chunk.push(c.u32());
    return { cls, addr, size: 0, chunk: chunk.slice(0, rank), index: 0 };
  }
  const flags = c.u8();
  const dim = c.u8();
  const enc = c.u8();
  const chunk: number[] = [];
  for (let i = 0; i < dim; i++) chunk.push(c.uN(enc));
  const index = c.u8();
  let single: Layout['single'];
  if (index === Chunks.Single) {
    if (flags & 2) single = { size: c.len(), mask: c.u32() };
  } else if (index === Chunks.FixedArray) c.skip(1);
  else if (index !== Chunks.Implicit) throw new Error(`HDF5 chunk index type ${index} is not supported (unlimited dimensions).`);
  return { cls, addr: c.addr(), size: 0, chunk: chunk.slice(0, rank), index, single };
}

function dataset(r: Reader, msgs: Message[], path: string): H5Dataset {
  const get = (t: number) => msgs.find((m) => m.type === t);
  const sp = get(Msg.Dataspace);
  const ty = get(Msg.Datatype);
  const lay = get(Msg.Layout);
  if (!sp || !ty || !lay) throw new Error(`HDF5 object ${path} is not a dataset.`);
  const shape = parseSpace(new Cur(sp.data, 0, r));
  const type = parseType(new Cur(ty.data, 0, r));
  const fm = get(Msg.Filters);
  const pipe = fm ? parseFilters(fm.data, r) : [];
  const layout = parseLayout(lay.data, r, shape.length);
  const attrs = attrsOf(msgs, r);
  const read = async (): Promise<H5Array> => {
    const count = shape.reduce((a, b) => a * b, 1);
    const bytes = count * type.size;
    if (layout.cls === 0) return decodeValues(lay.data.slice(layout.addr, layout.addr + bytes), type, count);
    if (layout.cls === 1) return decodeValues((await r.raw(layout.addr, bytes)).slice(), type, count);
    const out = new Uint8Array(bytes);
    const fill = typeof attrs._FillValue === 'number' ? attrs._FillValue : 0;
    if (fill !== 0) new (arrayCtor(type))(out.buffer).fill(fill);
    const cb = layout.chunk.reduce((a, b) => a * b, 1) * type.size;
    let chunks: Chunk[];
    if (layout.index === 0) {
      chunks = [];
      if (layout.addr >= 0) await btreeChunks(r, layout.addr, shape.length, chunks);
    } else if (layout.index === Chunks.Single)
      chunks = [{ offset: shape.map(() => 0), addr: layout.addr, size: layout.single?.size ?? cb, mask: layout.single?.mask ?? 0 }];
    else if (layout.index === Chunks.Implicit) chunks = gridOffsets(shape, layout.chunk).map((offset, i) => ({ offset, addr: layout.addr + i * cb, size: cb, mask: 0 }));
    else chunks = layout.addr < 0 ? [] : await fixedArrayChunks(r, layout.addr, shape, layout.chunk, cb, pipe.length > 0);
    for (const ch of chunks) {
      if (ch.addr < 0) continue;
      const data = await unfilter(await r.raw(ch.addr, ch.size), pipe, ch.mask);
      if (data.length < cb) throw new Error(`HDF5 chunk of ${path} is short: ${data.length} of ${cb} bytes.`);
      place(out, data, shape, layout.chunk, ch.offset, type.size);
    }
    return decodeValues(out, type, count);
  };
  return { shape, type, attrs, read };
}

/** Copies a chunk's in-bounds rows into the full array; chunks past the edge keep only their overlap. */
function place(out: Uint8Array, data: Uint8Array, shape: number[], chunk: number[], off: number[], es: number) {
  const rank = shape.length;
  const run = Math.min(chunk[rank - 1], shape[rank - 1] - off[rank - 1]) * es;
  if (run <= 0) return;
  const idx: number[] = Array.from({ length: rank - 1 }, () => 0);
  for (;;) {
    let ok = true;
    let dst = 0;
    let src = 0;
    for (let d = 0; d < rank - 1; d++) {
      const g = off[d] + idx[d];
      if (g >= shape[d]) ok = false;
      dst = dst * shape[d] + g;
      src = src * chunk[d] + idx[d];
    }
    if (ok) {
      dst = dst * shape[rank - 1] + off[rank - 1];
      src *= chunk[rank - 1];
      out.set(data.subarray(src * es, src * es + run), dst * es);
    }
    let d = rank - 2;
    for (; d >= 0; d--) {
      if (++idx[d] < chunk[d]) break;
      idx[d] = 0;
    }
    if (d < 0) return;
  }
}

export interface H5File {
  attrs: Record<string, H5Value>;
  dataset(path: string): Promise<H5Dataset>;
  has(path: string): Promise<boolean>;
}

export async function openHdf5(src: H5Source): Promise<H5File> {
  const r = new Reader(src);
  let sb = -1;
  for (let at = 0; at + 8 <= src.size; at = at ? at * 2 : 512) {
    const b = await r.bytes(at, 8, true);
    if (SIGNATURE.every((v, i) => b[i] === v)) {
      sb = at;
      break;
    }
  }
  if (sb < 0) throw new Error('Not an HDF5 file.');
  const b = await r.bytes(sb, 128, true);
  const c = new Cur(b, 8, r);
  const v = c.u8();
  let root: number;
  if (v <= 1) {
    c.skip(4);
    r.O = c.u8();
    r.L = c.u8();
    c.skip(1 + 4 + 4 + (v === 1 ? 4 : 0));
    r.base = c.addr();
    c.addr();
    c.addr();
    c.addr();
    c.addr();
    root = c.addr();
  } else if (v <= 3) {
    r.O = c.u8();
    r.L = c.u8();
    c.skip(1);
    r.base = c.addr();
    c.addr();
    c.addr();
    root = c.addr();
  } else throw new Error(`HDF5 superblock version ${v} is not supported.`);
  if (r.base < 0) r.base = 0;
  const rootMsgs = await readHeader(r, root);
  const resolve = async (path: string): Promise<Message[] | null> => {
    let msgs = rootMsgs;
    for (const part of path.split('/').filter(Boolean)) {
      const at = await child(r, msgs, part);
      if (at < 0) return null;
      msgs = await readHeader(r, at);
    }
    return msgs;
  };
  return {
    attrs: attrsOf(rootMsgs, r),
    has: async (path) => (await resolve(path)) !== null,
    dataset: async (path) => {
      const msgs = await resolve(path);
      if (!msgs) throw new Error(`HDF5 file has no ${path}.`);
      return dataset(r, msgs, path);
    }
  };
}
