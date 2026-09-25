import { describe, expect, it } from 'vitest';
import { nextTickDelay } from './clock';

describe('nextTickDelay', () => {
  it('lands just past the next whole second', () => {
    expect(nextTickDelay(10_250, true)).toBe(755);
    expect(nextTickDelay(10_000, true)).toBe(1005);
  });
  it('lands just past the next whole minute', () => {
    expect(nextTickDelay(60_000 * 7 + 59_990, false)).toBe(15);
    expect(nextTickDelay(60_000 * 7, false)).toBe(60_005);
  });
});
