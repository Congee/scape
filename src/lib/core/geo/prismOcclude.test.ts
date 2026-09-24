import { describe, expect, it } from 'vitest';
import { RoofShape, type BuildingBatch } from '@workers/buildings.protocol';
import { destination, type LngLat } from './geodesy';
import { batchOf, rect, square, type Box } from './batchFixture';
import { adoptPrismSlots, PrismOccluder, prismSlots } from './prismOcclude';
import { buildPrisms, type PrismTile } from './prismRaster';

const PIN: LngLat = { lng: -74, lat: 40.75 };
const D2R = Math.PI / 180;

const at = (e: number, n: number) => destination(PIN, (Math.atan2(e, n) * 180) / Math.PI, Math.hypot(e, n));

/** One axis-aligned box, `side` metres across, centred at (cE, cN) in local east/north metres. */
function boxOccluder(cE: number, cN: number, side: number, heightM: number, rangeM = 10_000): PrismOccluder {
  const ring: [number, number][] = [
    [cE - side / 2, cN - side / 2],
    [cE + side / 2, cN - side / 2],
    [cE + side / 2, cN + side / 2],
    [cE - side / 2, cN + side / 2]
  ];
  const batch: BuildingBatch = {
    tileKey: '14/0/0',
    count: 1,
    ringStart: new Int32Array([0, 4]),
    lng: new Float64Array(4),
    lat: new Float64Array(4),
    heightM: new Float32Array([heightM]),
    minHeightM: new Float32Array(1),
    roofShape: new Uint8Array([RoofShape.Flat]),
    roofHeightM: new Float32Array(1),
    roofDirDeg: new Float32Array(1).fill(NaN),
    roofAcross: new Uint8Array(1),
    cLng: new Float64Array(1),
    cLat: new Float64Array(1),
    groundM: new Float32Array(1)
  };
  for (const [k, [e, n]] of ring.entries()) {
    const p = at(e, n);
    batch.lng[k] = p.lng;
    batch.lat[k] = p.lat;
  }
  const c = at(cE, cN);
  batch.cLng[0] = c.lng;
  batch.cLat[0] = c.lat;
  return new PrismOccluder([buildPrisms(batch, PIN, 0)], rangeM);
}

/** Direction from an azimuth and an elevation, as the viewfinder builds it. */
const dir = (azDeg: number, altDeg: number): [number, number, number] => {
  const ca = Math.cos(altDeg * D2R);
  return [ca * Math.sin(azDeg * D2R), ca * Math.cos(azDeg * D2R), Math.sin(altDeg * D2R)];
};

describe('PrismOccluder', () => {
  // A 20 m box 100 m due north, so its top subtends about 11 degrees.
  const occ = boxOccluder(0, 100, 40, 20);

  it('hides a point straight behind the wall', () => {
    expect(occ.occludes(...dir(0, 0), Infinity)).toBe(true);
    expect(occ.occludes(...dir(0, 5), Infinity)).toBe(true);
  });

  it('leaves a point in front of the wall alone', () => {
    expect(occ.occludes(...dir(0, 0), 50)).toBe(false);
    expect(occ.occludes(...dir(0, 0), 99)).toBe(false);
    expect(occ.occludes(...dir(0, 0), 150)).toBe(true);
  });

  it('leaves other bearings alone', () => {
    expect(occ.occludes(...dir(180, 0), Infinity)).toBe(false);
    expect(occ.occludes(...dir(90, 0), Infinity)).toBe(false);
    expect(occ.occludes(...dir(30, 0), Infinity)).toBe(false);
  });

  it('leaves sight lines over the roof alone', () => {
    expect(occ.occludes(...dir(0, 20), Infinity)).toBe(false);
    expect(occ.occludes(0, 0, 1, Infinity)).toBe(false);
  });

  it('drops buildings beyond the draw range', () => {
    expect(boxOccluder(0, 100, 40, 20, 50).occludes(...dir(0, 0), Infinity)).toBe(false);
  });

  it('covers a bearing that wraps past north', () => {
    const west = boxOccluder(-100, 0, 40, 20);
    expect(west.occludes(...dir(270, 0), Infinity)).toBe(true);
    expect(west.occludes(...dir(275, 0), Infinity)).toBe(true);
    expect(west.occludes(...dir(300, 0), Infinity)).toBe(false);
  });
});

/** The per-entry occluder this module replaced, kept to pin the answers bit for bit. */
const REF_R2D = 180 / Math.PI;
/** One bucket per degree of azimuth; a query touches one of them. */
const REF_BUCKETS = 360;

interface RefEntry {
  tile: PrismTile;
  /** Building index within the tile. */
  i: number;
  uMin: number;
  uMax: number;
}

/** Scratch for the crossings of one footprint; a ring is never anywhere near this long. */
let refTs = new Float64Array(64);

/**
 * True when the horizontal ray `(dx, dy)` enters the footprint and the prism's height band covers
 * the ray there. The eye is the origin, so the ray parameter is also the 3D one.
 */
function refHitsPrism(tile: PrismTile, i: number, uMin: number, uMax: number, dx: number, dy: number, dz: number, maxT: number): boolean {
  const s0 = tile.ringStart[i];
  const len = tile.ringStart[i + 1] - s0;
  if (len < 3) return false;
  if (refTs.length < len) refTs = new Float64Array(len * 2);
  const useX = Math.abs(dx) >= Math.abs(dy);
  let k = 0;
  for (let j = 0; j < len; j++) {
    const a = s0 + j;
    const b = s0 + ((j + 1) % len);
    const e1 = tile.e[a];
    const n1 = tile.n[a];
    const eE = tile.e[b] - e1;
    const eN = tile.n[b] - n1;
    const den = eE * dy - eN * dx;
    if (den === 0) continue;
    // Half open, so a ray through a vertex crosses once and the even-odd parity holds.
    const s = (n1 * dx - e1 * dy) / den;
    if (s < 0 || s >= 1) continue;
    const t = useX ? (e1 + s * eE) / dx : (n1 + s * eN) / dy;
    if (t > 0) refTs[k++] = t;
  }
  if (k < 1) return false;
  for (let a = 1; a < k; a++) {
    const v = refTs[a];
    let b = a - 1;
    while (b >= 0 && refTs[b] > v) {
      refTs[b + 1] = refTs[b];
      b--;
    }
    refTs[b + 1] = v;
  }
  // Beyond the last crossing the ray is outside, so inside spans pair off from the end;
  // an odd count leaves the eye itself inside the footprint, out to the first crossing.
  const spans = (t0: number, t1: number) => {
    if (t0 >= maxT) return false;
    const u0 = t0 * dz;
    const u1 = Math.min(t1, maxT) * dz;
    return Math.max(u0, u1) >= uMin && Math.min(u0, u1) <= uMax;
  };
  for (let a = k - 1; a > 0; a -= 2) if (spans(refTs[a - 1], refTs[a])) return true;
  return k % 2 === 1 && spans(0, refTs[0]);
}

/** Bucket slots per tile, kept so tiles streaming in do not re-index the ones already there. */
const refPlaced = new WeakMap<PrismTile, { rangeM: number; slots: RefSlots }>();

/** Parallel bucket indices and entries. */
interface RefSlots {
  bucket: number[];
  entry: RefEntry[];
}

function refTileEntries(tile: PrismTile, rangeM: number): RefSlots {
  const slots: RefSlots = { bucket: [], entry: [] };
  for (let i = 0; i < tile.count; i++) {
    if (tile.ringStart[i + 1] - tile.ringStart[i] < 3) continue;
    if (Math.max(1, tile.distM[i]) > rangeM) continue;
    const ce = tile.cE[i];
    const cn = tile.cN[i];
    const l = Math.hypot(ce, cn);
    if (l < 1e-6) continue;
    let uMin = Infinity;
    let uMax = -Infinity;
    for (let v = tile.ringStart[i]; v < tile.ringStart[i + 1]; v++) {
      if (tile.uBase[v] < uMin) uMin = tile.uBase[v];
      if (tile.uTop[v] > uMax) uMax = tile.uTop[v];
    }
    for (let q = tile.faceVert[tile.faceStart[i]]; q < tile.faceVert[tile.faceStart[i + 1]]; q++) {
      if (tile.fU[q] < uMin) uMin = tile.fU[q];
      if (tile.fU[q] > uMax) uMax = tile.fU[q];
    }
    if (!(uMax >= uMin)) continue;
    const entry: RefEntry = { tile, i, uMin, uMax };
    const centre = Math.atan2(ce, cn) * REF_R2D;
    const r = tile.radiusM[i];
    // Horizontal half-width of the bounding sphere, widened a bucket so an edge lands inside;
    // a sphere the eye stands in has no bearing at all and goes everywhere.
    const half = r >= l ? 180 : Math.asin(r / l) * REF_R2D + 1;
    const lo = Math.floor(centre - half);
    const hi = Math.min(Math.ceil(centre + half), lo + REF_BUCKETS - 1);
    for (let b = lo; b <= hi; b++) {
      slots.bucket.push(((b % REF_BUCKETS) + REF_BUCKETS) % REF_BUCKETS);
      slots.entry.push(entry);
    }
  }
  return slots;
}

/**
 * Buildings bucketed by azimuth, so one direction costs a bucket lookup and a handful of tests.
 * Prisms are eye-relative and immobile, so an index outlives every pan and zoom.
 */
class RefOccluder {
  private readonly buckets: RefEntry[][] = Array.from({ length: REF_BUCKETS }, () => []);

  constructor(tiles: Iterable<PrismTile>, rangeM: number) {
    for (const tile of tiles) {
      let c = refPlaced.get(tile);
      if (c?.rangeM !== rangeM) refPlaced.set(tile, (c = { rangeM, slots: refTileEntries(tile, rangeM) }));
      for (let k = 0; k < c.slots.bucket.length; k++) this.buckets[c.slots.bucket[k]].push(c.slots.entry[k]);
    }
  }

  /** True when a building stands between the eye and a point `distM` away along `(e, n, u)`. */
  occludes(e: number, n: number, u: number, distM: number): boolean {
    const len = Math.hypot(e, n, u);
    if (len < 1e-9) return false;
    const dx = e / len;
    const dy = n / len;
    const dz = u / len;
    // Straight up or down: no wall can stand in the way, and the footprint test would divide by zero.
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return false;
    const az = Math.atan2(dx, dy) * REF_R2D;
    const bucket = this.buckets[((Math.floor(az) % REF_BUCKETS) + REF_BUCKETS) % REF_BUCKETS];
    const maxT = Number.isFinite(distM) ? distM : Infinity;
    for (const q of bucket) {
      const { tile, i } = q;
      const ce = tile.cE[i];
      const cn = tile.cN[i];
      const cu = tile.cU[i];
      const t = ce * dx + cn * dy + cu * dz;
      if (t <= 0 || t > maxT) continue;
      const r = tile.radiusM[i];
      if (ce * ce + cn * cn + cu * cu - t * t > r * r) continue;
      if (refHitsPrism(tile, i, q.uMin, q.uMax, dx, dy, dz, maxT)) return true;
    }
    return false;
  }
}

describe('PrismOccluder against the per-entry index', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32);
  const shapes = [RoofShape.Flat, RoofShape.Gabled, RoofShape.Hipped, RoofShape.Pyramidal, RoofShape.Skillion];
  const boxes: Box[] = [];
  for (let k = 0; k < 400; k++) {
    const l = 5 + 1500 * rnd() ** 2;
    const a = rnd() * 2 * Math.PI;
    boxes.push({
      ring: rect(l * Math.sin(a), l * Math.cos(a), 4 + 60 * rnd(), 4 + 60 * rnd()),
      heightM: 3 + 120 * rnd(),
      minHeightM: rnd() < 0.2 ? 5 : 0,
      groundM: 40 * rnd() - 20,
      roofShape: shapes[k % shapes.length],
      roofHeightM: 6 * rnd(),
      roofDirDeg: rnd() < 0.5 ? NaN : 360 * rnd()
    });
  }
  // One the eye stands inside, so it spans every bucket.
  boxes.push({ ring: square(0, 0, 10), heightM: 8 });
  const tiles = [batchOf(boxes.slice(0, 200)), batchOf(boxes.slice(200))].map((b) => buildPrisms(b, PIN, 2));

  it('gives the same answer in every direction, range and distance', () => {
    for (const rangeM of [20_000, 600]) {
      const ref = new RefOccluder(tiles, rangeM);
      // Worker path: slots built beside a copy of the tile and cloned across as a message would be.
      const sent = structuredClone(tiles.map((t) => ({ t, s: prismSlots(t, rangeM) })));
      for (const { t, s } of sent) adoptPrismSlots(t, s);
      const occs = [new PrismOccluder(tiles, rangeM), new PrismOccluder(sent.map((x) => x.t), rangeM)];
      let hits = 0;
      for (let az = -0.5; az < 360; az += 0.37)
        for (const alt of [-4, -0.5, 0, 0.3, 1, 2.5, 5, 9, 15, 30, 60])
          for (const distM of [Infinity, 30, 150, 700, 2000]) {
            const d = dir(az, alt);
            const want = ref.occludes(...d, distM);
            if (want) hits++;
            for (const occ of occs) if (occ.occludes(...d, distM) !== want) expect.fail(`az ${az} alt ${alt} d ${distM} range ${rangeM}`);
          }
      expect(hits).toBeGreaterThan(1000);
    }
  });
});
