import { describe, expect, it } from 'vitest';
import { BlockCache } from './blockCache';
import type { MeshBlock } from './mesh';

const block = (floats: number): MeshBlock => ({ pos: new Float32Array(floats), nrm: new Float32Array(floats), box: new Float32Array(6), missing: 0 });
// 8 * 4 * 2 + 24 bytes.
const B = 88;

describe('BlockCache', () => {
  it('drops the least recently used block past its budget', () => {
    const c = new BlockCache(2 * B);
    c.setAnchor('a');
    c.set('1', block(8));
    c.set('2', block(8));
    expect(c.get('1')).toBeDefined();
    c.set('3', block(8));
    expect(c.get('2')).toBeUndefined();
    expect(c.get('1')).toBeDefined();
    expect(c.get('3')).toBeDefined();
    expect(c.bytes).toBe(2 * B);
  });

  it('empties when the eye moves, and not when it stays', () => {
    const c = new BlockCache(10 * B);
    c.setAnchor('a');
    c.set('1', block(8));
    c.setAnchor('a');
    expect(c.size).toBe(1);
    c.setAnchor('b');
    expect(c.size).toBe(0);
    expect(c.bytes).toBe(0);
  });

  it('counts a replaced block once', () => {
    const c = new BlockCache(10 * B);
    c.set('1', block(8));
    c.set('1', block(8));
    expect(c.bytes).toBe(B);
  });
});
