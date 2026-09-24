import { describe, expect, it } from 'vitest';
import { GeoidVersion } from '@core/geo/geoid';
import { storeGeoid, type GeoidMeta } from './geoid';

/** An in-memory OPFS directory whose writes fail once `quota` bytes are stored. */
function memDir(quota = Infinity) {
  const files = new Map<string, Uint8Array>();
  const used = () => [...files.values()].reduce((s, b) => s + b.byteLength, 0);
  const dir = {
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!opts?.create) throw new DOMException('missing', 'NotFoundError');
        files.set(name, new Uint8Array(0));
      }
      return {
        getFile: async () => new Blob([files.get(name)! as Uint8Array<ArrayBuffer>]),
        createWritable: async () => {
          files.set(name, new Uint8Array(0));
          return {
            write: async (b: Uint8Array) => {
              if (used() + b.byteLength > quota) throw new DOMException('quota', 'QuotaExceededError');
              files.set(name, b.slice());
            },
            close: async () => undefined
          };
        }
      };
    },
    removeEntry: async (name: string) => {
      if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError');
    },
    keys: async function* () {
      yield* files.keys();
    }
  };
  return { dir: dir as unknown as FileSystemDirectoryHandle, files };
}

const meta = (grid: string, bytes: number): GeoidMeta & { grid: string } => ({ lat0: 20, lng0: 120, dLat: 1 / 60, dLng: 1.5 / 60, rows: 1, cols: bytes / 4, version: GeoidVersion.V22, fileName: 'a.asc', importedAt: grid, bytes, grid });

describe('storeGeoid', () => {
  it('swaps in the new grid and drops the old one', async () => {
    const { dir, files } = memDir();
    files.set('grid.f32', new Uint8Array(8));
    files.set('meta.json', new TextEncoder().encode(JSON.stringify({ ...meta('grid.f32', 8), grid: undefined })));
    await storeGeoid(dir, new Uint8Array(16), meta('grid-b.f32', 16));
    expect([...files.keys()].toSorted()).toEqual(['grid-b.f32', 'meta.json']);
    expect(JSON.parse(new TextDecoder().decode(files.get('meta.json')))).toMatchObject({ grid: 'grid-b.f32', bytes: 16 });
  });

  it('keeps the old grid and meta when the new grid does not fit', async () => {
    const { dir, files } = memDir(200);
    const oldMeta = new TextEncoder().encode(JSON.stringify(meta('grid-a.f32', 8)));
    files.set('grid-a.f32', new Uint8Array(8).fill(7));
    files.set('meta.json', oldMeta);
    await expect(storeGeoid(dir, new Uint8Array(400), meta('grid-b.f32', 400))).rejects.toThrow('quota');
    expect([...files.keys()].toSorted()).toEqual(['grid-a.f32', 'meta.json']);
    expect(files.get('meta.json')).toEqual(oldMeta);
    expect(files.get('grid-a.f32')).toEqual(new Uint8Array(8).fill(7));
  });

  it('restores the old meta when only the meta write fails', async () => {
    const { dir, files } = memDir(40);
    files.set('grid-a.f32', new Uint8Array(4));
    const oldMeta = new TextEncoder().encode('{"grid":"grid-a.f32"}');
    files.set('meta.json', oldMeta);
    await expect(storeGeoid(dir, new Uint8Array(12), meta('grid-b.f32', 12))).rejects.toThrow('quota');
    expect([...files.keys()].toSorted()).toEqual(['grid-a.f32', 'meta.json']);
    expect(files.get('meta.json')).toEqual(oldMeta);
  });
});
