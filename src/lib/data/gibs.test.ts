import { describe, expect, it } from 'vitest';
import { gibsFiles, NO_GIBS, summarizeGibs, type SizedDir, type SizedFile } from './gibs';

const file = (size: number): SizedFile => ({ kind: 'file', getFile: async () => ({ size }) });
const dir = (children: Record<string, SizedDir | SizedFile>): SizedDir => ({
  kind: 'directory',
  async *entries() {
    yield* Object.entries(children);
  }
});

describe('summarizeGibs', () => {
  it('is empty for no files', () => {
    expect(summarizeGibs([])).toEqual(NO_GIBS);
  });

  it('counts bytes everywhere but tiles and nights only for non-empty tiles', () => {
    const u = summarizeGibs([
      { night: '', bytes: 60 },
      { night: '2026-09-20', bytes: 1000 },
      { night: '2026-09-20', bytes: 0 },
      { night: '2026-09-21', bytes: 500 },
      { night: '2026-09-22', bytes: 0 }
    ]);
    expect(u).toEqual({ bytes: 1560, nights: 2, tiles: 2 });
  });
});

describe('gibsFiles', () => {
  it('walks night folders one level deep', async () => {
    const root = dir({
      'latest.json': file(48),
      '2026-09-20': dir({ '8-1-2.png': file(3000), '8-1-3.png': file(0) }),
      '2026-09-21': dir({ '8-1-2.png': file(2500), nested: dir({ 'x.png': file(9) }) })
    });
    const files = (await gibsFiles(root)).toSorted((a, b) => a.night.localeCompare(b.night) || a.bytes - b.bytes);
    expect(files).toEqual([
      { night: '', bytes: 48 },
      { night: '2026-09-20', bytes: 0 },
      { night: '2026-09-20', bytes: 3000 },
      { night: '2026-09-21', bytes: 2500 }
    ]);
    expect(summarizeGibs(files)).toEqual({ bytes: 5548, nights: 2, tiles: 2 });
  });

  it('reads an emptied cache as nothing', async () => {
    expect(summarizeGibs(await gibsFiles(dir({})))).toEqual(NO_GIBS);
  });
});
