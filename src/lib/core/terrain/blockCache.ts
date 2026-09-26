import type { MeshBlock } from './mesh';

/** Mesh blocks by key for one eye, least recently used first out once past a byte budget. */
export class BlockCache {
  private anchor = '';
  private blocks = new Map<string, MeshBlock>();
  private used = 0;

  constructor(
    readonly budgetBytes: number,
    /** Told of every block that leaves, so its buffers can be reused. */
    private readonly onEvict: (b: MeshBlock) => void = () => {}
  ) {}

  /** Eye-relative blocks go stale when the eye moves, so a new anchor empties the cache. */
  setAnchor(anchor: string) {
    if (anchor === this.anchor) return;
    this.anchor = anchor;
    for (const b of this.blocks.values()) this.onEvict(b);
    this.blocks.clear();
    this.used = 0;
  }

  get(key: string): MeshBlock | undefined {
    const b = this.blocks.get(key);
    if (!b) return undefined;
    this.blocks.delete(key);
    this.blocks.set(key, b);
    return b;
  }

  set(key: string, b: MeshBlock) {
    const old = this.blocks.get(key);
    if (old) {
      this.used -= bytesOf(old);
      this.blocks.delete(key);
      if (old !== b) this.onEvict(old);
    }
    this.blocks.set(key, b);
    this.used += bytesOf(b);
    for (const [k, v] of this.blocks) {
      if (this.used <= this.budgetBytes) break;
      this.blocks.delete(k);
      this.used -= bytesOf(v);
      this.onEvict(v);
    }
  }

  get bytes(): number {
    return this.used;
  }

  get size(): number {
    return this.blocks.size;
  }
}

// Whole buffers: a pooled block's arrays may be views into larger ones.
const bytesOf = (b: MeshBlock) => b.pos.buffer.byteLength + b.nrm.buffer.byteLength + b.box.byteLength;
