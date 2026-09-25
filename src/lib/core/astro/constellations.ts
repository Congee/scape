import { eqjVector, type StarCatalog } from './stars';

export interface ConstellationData {
  name: string;
  /** Label position [RA°, Dec°]. */
  at: [number, number];
  /** Polylines of [RA°, Dec°]. */
  lines: [number, number][][];
}

export type ConstellationSet = Record<string, ConstellationData>;

/** Lines as J2000 unit-vector segments, ready for one matrix multiply per vertex. */
export interface PreparedConstellations {
  ids: string[];
  names: string[];
  /** xyz per constellation label. */
  centres: Float32Array;
  /** x0 y0 z0 x1 y1 z1 per segment. */
  segments: Float32Array;
}

/** Wider than the lines' 0.01° rounding plus 25 years of proper motion (α Cen: 95″). */
const SNAP_RAD = (120 / 3600) * (Math.PI / 180);
const SNAP_COS = Math.cos(SNAP_RAD);

/** The brightest catalogue star within the snap radius, so a line meets a double's primary; null if none. */
export function snapToStar(v: [number, number, number], stars: StarCatalog): [number, number, number] | null {
  let best = -1;
  for (let i = 0; i < stars.n; i++) {
    if (Math.abs(v[2] - stars.z[i]) > SNAP_RAD) continue;
    if (v[0] * stars.x[i] + v[1] * stars.y[i] + v[2] * stars.z[i] < SNAP_COS) continue;
    if (best < 0 || stars.mag[i] < stars.mag[best]) best = i;
  }
  return best < 0 ? null : [stars.x[best], stars.y[best], stars.z[best]];
}

/** With a catalogue, each vertex lands on its star, so the lines carry the stars' proper motion. */
export function prepareConstellations(set: ConstellationSet, stars?: StarCatalog | null): PreparedConstellations {
  const snapped = new Map<string, [number, number, number]>();
  const vertex = ([ra, dec]: [number, number]) => {
    const key = `${ra},${dec}`;
    let v = snapped.get(key);
    if (!v) {
      const raw = eqjVector(ra, dec);
      v = (stars && snapToStar(raw, stars)) || raw;
      snapped.set(key, v);
    }
    return v;
  };
  const ids = Object.keys(set).toSorted();
  const names = ids.map((id) => set[id].name);
  const centres = new Float32Array(ids.length * 3);
  const segs: number[] = [];
  ids.forEach((id, i) => {
    const c = set[id];
    centres.set(eqjVector(c.at[0], c.at[1]), i * 3);
    for (const line of c.lines) {
      for (let k = 0; k + 1 < line.length; k++) {
        segs.push(...vertex(line[k]), ...vertex(line[k + 1]));
      }
    }
  });
  return { ids, names, centres, segments: new Float32Array(segs) };
}
