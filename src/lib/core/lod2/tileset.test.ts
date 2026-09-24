import { describe, expect, it } from 'vitest';
import { destination, type LngLat } from '@core/geo/geodesy';
import { ecefToGeodetic, geodeticToEcef } from './ecef';
import { mul4, Refine, resolveUri, volumeSphere, walkTileset, type TileJson, type TilesetJson, type WalkView } from './tileset';

const PIN: LngLat = { lng: 4.4868, lat: 51.9091 };
const I = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const VIEW: WalkView = { pin: PIN, eyeH: 50, pxPerRad: 1000, maxErrorPx: 16, rangeM: 5000, azFromDeg: 0, azSpanDeg: 360 };

/** A 100 m ECEF box tile centred `d` metres from the pin toward `az`. */
function boxAt(az: number, d: number, extra: Partial<TileJson> = {}): TileJson {
  const p = destination(PIN, az, d);
  const [x, y, z] = geodeticToEcef(p.lng, p.lat, 0);
  return { boundingVolume: { box: [x, y, z, 50, 0, 0, 0, 50, 0, 0, 0, 50] }, geometricError: 0, ...extra };
}

const set = (root: TileJson): TilesetJson => ({ asset: { version: '1.1' }, root });
const walk = (tilesets: Record<string, TilesetJson>, view: Partial<WalkView> = {}) => walkTileset('https://t.test/a/tileset.json', (u) => tilesets[u], { ...VIEW, ...view });
const urls = (r: ReturnType<typeof walk>) => r.contents.map((c) => c.url.replace('https://t.test/', ''));

describe('volumeSphere', () => {
  it('bounds a box by its half-axis diagonal, through the transform', () => {
    const m = new Float64Array(I);
    m[0] = m[5] = m[10] = 2;
    m[12] = 10;
    expect(volumeSphere({ box: [1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 3] }, m)).toEqual({ x: 12, y: 4, z: 6, r: 10 });
  });

  it('scales a sphere by the largest axis', () => {
    const m = new Float64Array(I);
    m[5] = 3;
    expect(volumeSphere({ sphere: [1, 1, 1, 2] }, m)).toEqual({ x: 1, y: 3, z: 1, r: 6 });
  });

  it('bounds a region in ECEF and ignores the transform', () => {
    const D = Math.PI / 180;
    const s = volumeSphere({ region: [4.48 * D, 51.9 * D, 4.49 * D, 51.91 * D, 0, 100] }, mul4(I, [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 9, 9, 9, 1]));
    const g = ecefToGeodetic(s.x, s.y, s.z);
    expect(g.lng).toBeCloseTo(4.485, 3);
    expect(g.lat).toBeCloseTo(51.905, 3);
    expect(s.r).toBeGreaterThan(600);
    expect(s.r).toBeLessThan(700);
  });

  it('throws on an unknown volume', () => {
    expect(() => volumeSphere({}, I)).toThrow(/not a box/);
  });
});

describe('walkTileset', () => {
  it('resolves content against the tileset that names it', () => {
    expect(resolveUri('https://t.test/a/b/tileset.json', '../c/1.glb')).toBe('https://t.test/a/c/1.glb');
  });

  it('refines by screen error, REPLACE drops the parent, nearest first', () => {
    const root = boxAt(0, 300, { geometricError: 100, content: { uri: 'root.glb' }, children: [boxAt(0, 600, { content: { uri: 'far.glb' } }), boxAt(0, 200, { content: { uri: 'near.glb' } })] });
    expect(urls(walk({ 'https://t.test/a/tileset.json': set(root) }))).toEqual(['a/near.glb', 'a/far.glb']);
    // 100 m of error at ~250 m is 400 px at 1000 px/rad; at 10 px/rad it is well under 16.
    expect(urls(walk({ 'https://t.test/a/tileset.json': set(root) }, { pxPerRad: 10 }))).toEqual(['a/root.glb']);
  });

  it('ADD keeps the parent with its children', () => {
    const root = boxAt(0, 300, { geometricError: 100, refine: Refine.Add, content: { uri: 'root.glb' }, children: [boxAt(0, 200, { content: { uri: 'kid.glb' } })] });
    expect(urls(walk({ 'https://t.test/a/tileset.json': set(root) })).toSorted()).toEqual(['a/kid.glb', 'a/root.glb']);
  });

  it('culls by range and by the azimuth wedge', () => {
    const root = boxAt(0, 0, { geometricError: 100, boundingVolume: { sphere: [...geodeticToEcef(PIN.lng, PIN.lat, 0), 20000] }, children: [boxAt(90, 1000, { content: { uri: 'east.glb' } }), boxAt(270, 1000, { content: { uri: 'west.glb' } }), boxAt(90, 9000, { content: { uri: 'far.glb' } })] });
    const ts = { 'https://t.test/a/tileset.json': set(root) };
    expect(urls(walk(ts)).toSorted()).toEqual(['a/east.glb', 'a/west.glb']);
    expect(urls(walk(ts, { azFromDeg: 60, azSpanDeg: 60 }))).toEqual(['a/east.glb']);
    expect(urls(walk(ts, { azFromDeg: 250, azSpanDeg: 60, rangeM: 20000 }))).toEqual(['a/west.glb']);
  });

  it('follows external tilesets, reports missing ones, and keeps a REPLACE parent until they arrive', () => {
    const root = boxAt(0, 300, { geometricError: 100, content: { uri: 'root.glb' }, children: [boxAt(0, 200, { content: { uri: 'sub/tileset.json' } })] });
    const sub = set(boxAt(0, 200, { content: { uri: 'leaf.glb' } }));
    const only = { 'https://t.test/a/tileset.json': set(root) };
    const r = walk(only);
    expect(r.pending).toEqual(['https://t.test/a/sub/tileset.json']);
    expect(urls(r)).toEqual(['a/root.glb']);
    expect(urls(walk({ ...only, 'https://t.test/a/sub/tileset.json': sub }))).toEqual(['a/sub/leaf.glb']);
    expect(walk({})).toEqual({ contents: [], pending: ['https://t.test/a/tileset.json'] });
  });

  it('chains tile transforms onto content', () => {
    const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
    const root = boxAt(0, 100, { transform: t, content: { uri: 'x.glb' } });
    const c = walk({ 'https://t.test/a/tileset.json': set({ ...root, boundingVolume: { sphere: [...geodeticToEcef(PIN.lng, PIN.lat, 0), 100] } }) }).contents;
    expect(Array.from(c[0].transform.subarray(12, 15))).toEqual([5, 6, 7]);
  });
});
