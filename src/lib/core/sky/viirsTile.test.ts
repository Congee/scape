import { describe, expect, it } from 'vitest';
import { bytesSource } from '@core/io/hdf5';
import { H5_EARLIEST, H5_LATEST } from '@core/io/hdf5.fixtures';
import { decodeViirsTile } from './viirsTile';

const bytes = (b64: string) => bytesSource(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const NAME = 'VNP46A4.A2024001.h18v03.002.2025161220719.h5';

describe.each([H5_EARLIEST, H5_LATEST])('decodeViirsTile', (b64) => {
  it('reads year, tile and counts with fill as dark', async () => {
    const t = await decodeViirsTile(bytes(b64), NAME, 40);
    expect(t.year).toBe(2024);
    expect(t.tile).toEqual({ h: 18, v: 3 });
    expect(t.counts[0]).toBe(0);
    expect(t.counts[1234]).toBe(234);
    expect(t.counts[40 * 40 - 1]).toBe(0);
  });

  it('rejects a name that disagrees with the tile attributes', async () => {
    await expect(decodeViirsTile(bytes(b64), NAME.replace('h18', 'h19'), 40)).rejects.toThrow(/holds tile h18v3/);
  });

  it('rejects a grid of the wrong size', async () => {
    await expect(decodeViirsTile(bytes(b64), NAME)).rejects.toThrow(/2400×2400/);
  });
});

it('rejects a file without a VNP46A4 name', async () => {
  await expect(decodeViirsTile(bytes(H5_LATEST), 'tile.h5', 40)).rejects.toThrow(/not a VNP46A4/);
});
