import { eqjVector } from './stars';

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

export function prepareConstellations(set: ConstellationSet): PreparedConstellations {
  const ids = Object.keys(set).toSorted();
  const names = ids.map((id) => set[id].name);
  const centres = new Float32Array(ids.length * 3);
  const segs: number[] = [];
  ids.forEach((id, i) => {
    const c = set[id];
    centres.set(eqjVector(c.at[0], c.at[1]), i * 3);
    for (const line of c.lines) {
      for (let k = 0; k + 1 < line.length; k++) {
        segs.push(...eqjVector(line[k][0], line[k][1]), ...eqjVector(line[k + 1][0], line[k + 1][1]));
      }
    }
  });
  return { ids, names, centres, segments: new Float32Array(segs) };
}
