import { describe, expect, it } from 'vitest';
import { InFlight } from './inFlight';

describe('InFlight', () => {
  it('counts a tile the caller has not read as held', () => {
    const f = new InFlight();
    const n = f.post('14/1/2', 'a');
    f.read(n - 1);
    expect(f.pending('14/1/2', 'a')).toBe(true);
  });

  it('rebuilds a tile the caller has read, whether it kept it or not', () => {
    const f = new InFlight();
    const n = f.post('14/1/2', 'a');
    f.read(n);
    expect(f.pending('14/1/2', 'a')).toBe(false);
  });

  it('rebuilds a tile in flight for another sig', () => {
    const f = new InFlight();
    f.post('14/1/2', 'a');
    f.read(0);
    expect(f.pending('14/1/2', 'b')).toBe(false);
  });

  it('keeps the newest post of a key and forgets only what was read', () => {
    const f = new InFlight();
    f.post('x', 'a');
    const y = f.post('y', 'a');
    f.post('x', 'b');
    f.read(y);
    expect(f.pending('x', 'b')).toBe(true);
    expect(f.pending('x', 'a')).toBe(false);
    expect(f.pending('y', 'a')).toBe(false);
  });
});
