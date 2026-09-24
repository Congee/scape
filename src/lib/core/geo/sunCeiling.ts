/**
 * Cast shadows for the viewfinder's software rasteriser. Terrain and buildings are both vertical
 * columns over a height grid, so one march along the sun's ground direction answers all four cases
 * at once: terrain on terrain, terrain on buildings, buildings on ground, buildings on each other.
 */

const D2R = Math.PI / 180;

/**
 * A regular east/north grid of surface heights in metres, axis aligned. Cell (ix, iy) has its centre
 * at `originE + ix * cellM`, `originN + iy * cellM`; `iy` increases north. Row-major.
 */
export interface HeightGrid {
  cellM: number;
  nx: number;
  ny: number;
  originE: number;
  originN: number;
  /** Surface height above the datum, metres; NaN where nothing is known. */
  h: Float32Array;
}

/**
 * Height at or below which a point in each cell is in the sun's shadow, metres; a point is lit when
 * its height is above the value here. -Infinity marks a cell nothing can shadow.
 *
 * At or below the horizon every cell comes back -Infinity: nothing is lit and night is the caller's.
 */
export function sunCeiling(g: HeightGrid, sunAzDeg: number, sunAltDeg: number): Float32Array {
  const { nx, ny, cellM, h } = g;
  const out = new Float32Array(nx * ny);
  if (!(sunAltDeg > 0)) {
    out.fill(-Infinity);
    return out;
  }
  // A vertical sun casts nothing past the column itself, and tan would blow up.
  if (sunAltDeg >= 90) {
    for (let i = 0; i < out.length; i++) {
      const hi = h[i];
      out[i] = Number.isNaN(hi) ? -Infinity : hi;
    }
    return out;
  }
  const bear = (sunAzDeg + 180) * D2R;
  const dE = Math.sin(bear);
  const dN = Math.cos(bear);
  const xMajor = Math.abs(dE) >= Math.abs(dN);
  const dMaj = xMajor ? dE : dN;
  const dMin = xMajor ? dN : dE;
  const nMaj = xMajor ? nx : ny;
  const nMin = xMajor ? ny : nx;
  const majStride = xMajor ? 1 : nx;
  const minStride = xMajor ? nx : 1;
  const step = dMaj >= 0 ? 1 : -1;
  const absMaj = dMaj * step;
  // One dominant-axis index covers cellM / |dMaj| of ground, so the more diagonal the sun the further.
  const fall = (cellM / absMaj) * Math.tan(sunAltDeg * D2R);
  // Minor-axis offset of the sample one step back along d; |t| <= 1 by the choice of dominant axis.
  const t = dMin / absMaj;
  for (let k = 0; k < nMaj; k++) {
    const iMaj = step > 0 ? k : nMaj - 1 - k;
    const base = iMaj * majStride;
    // The first line has no predecessor upwind.
    if (k === 0) {
      for (let iMin = 0; iMin < nMin; iMin++) {
        const idx = base + iMin * minStride;
        const hi = h[idx];
        out[idx] = Number.isNaN(hi) ? -Infinity : hi;
      }
      continue;
    }
    const prevBase = (iMaj - step) * majStride;
    for (let iMin = 0; iMin < nMin; iMin++) {
      const idx = base + iMin * minStride;
      const hi = h[idx];
      if (Number.isNaN(hi)) {
        out[idx] = -Infinity;
        continue;
      }
      const p = iMin - t;
      const f = Math.floor(p);
      const a0 = f >= 0 && f < nMin ? out[prevBase + f * minStride] : -Infinity;
      const a1 = f + 1 >= 0 && f + 1 < nMin ? out[prevBase + (f + 1) * minStride] : -Infinity;
      // An unknown neighbour drops out of the blend rather than erasing the shadow beside it.
      let prev: number;
      if (a0 === -Infinity) prev = a1;
      else if (a1 === -Infinity) prev = a0;
      else prev = a0 + (a1 - a0) * (p - f);
      const c = prev - fall;
      out[idx] = c > hi ? c : hi;
    }
  }
  return out;
}


// Scratch for the scanline crossings; one footprint is stamped at a time.
let xs = new Float64Array(64);

/** Raises a grid to `heightM` wherever the footprint covers it, so a building becomes a column. */
export function stampFootprint(g: HeightGrid, ringE: readonly number[], ringN: readonly number[], heightM: number): void {
  const m = ringE.length;
  if (m < 3 || !Number.isFinite(heightM)) return;
  if (xs.length < m) xs = new Float64Array(Math.max(64, m * 2));
  const { nx, ny, cellM, h } = g;
  let n0 = Infinity;
  let n1 = -Infinity;
  for (let i = 0; i < m; i++) {
    if (ringN[i] < n0) n0 = ringN[i];
    if (ringN[i] > n1) n1 = ringN[i];
  }
  const iy0 = Math.max(0, Math.ceil((n0 - g.originN) / cellM));
  const iy1 = Math.min(ny - 1, Math.floor((n1 - g.originN) / cellM));
  for (let iy = iy0; iy <= iy1; iy++) {
    const y = g.originN + iy * cellM;
    let k = 0;
    for (let i = 0, j = m - 1; i < m; j = i++) {
      const yi = ringN[i];
      const yj = ringN[j];
      if (yi <= y === yj <= y) continue;
      xs[k++] = ringE[i] + ((y - yi) / (yj - yi)) * (ringE[j] - ringE[i]);
    }
    if (k < 2) continue;
    for (let i = 1; i < k; i++) {
      const v = xs[i];
      let j = i - 1;
      while (j >= 0 && xs[j] > v) {
        xs[j + 1] = xs[j];
        j--;
      }
      xs[j + 1] = v;
    }
    const row = iy * nx;
    for (let s = 0; s + 1 < k; s += 2) {
      const ix0 = Math.max(0, Math.ceil((xs[s] - g.originE) / cellM));
      const ix1 = Math.min(nx - 1, Math.floor((xs[s + 1] - g.originE) / cellM));
      for (let ix = ix0; ix <= ix1; ix++) {
        const idx = row + ix;
        // Written as a failed >= so an unknown cell takes the building rather than staying NaN.
        if (!(h[idx] >= heightM)) h[idx] = heightM;
      }
    }
  }
}

/**
 * Raises the grid to a triangle soup's surface: each triangle's plan projection at its interpolated
 * height, and each vertex into its nearest cell so a spire thinner than a cell still casts.
 */
export function stampTriangles(g: HeightGrid, e: ArrayLike<number>, n: ArrayLike<number>, u: ArrayLike<number>): void {
  const { nx, ny, cellM, h } = g;
  const raise = (idx: number, v: number) => {
    if (!(h[idx] >= v)) h[idx] = v;
  };
  for (let t = 0; t + 2 < e.length; t += 3) {
    const [ae, be, ce] = [e[t], e[t + 1], e[t + 2]];
    const [an, bn, cn] = [n[t], n[t + 1], n[t + 2]];
    const [au, bu, cu] = [u[t], u[t + 1], u[t + 2]];
    for (const [ve, vn, vu] of [[ae, an, au], [be, bn, bu], [ce, cn, cu]]) {
      const ix = Math.round((ve - g.originE) / cellM);
      const iy = Math.round((vn - g.originN) / cellM);
      if (ix >= 0 && ix < nx && iy >= 0 && iy < ny && Number.isFinite(vu)) raise(iy * nx + ix, vu);
    }
    const det = (be - ae) * (cn - an) - (ce - ae) * (bn - an);
    // Walls project to a line; their vertices and neighbouring roofs carry them.
    if (Math.abs(det) < 1e-9 || !Number.isFinite(au + bu + cu)) continue;
    const ix0 = Math.max(0, Math.ceil((Math.min(ae, be, ce) - g.originE) / cellM));
    const ix1 = Math.min(nx - 1, Math.floor((Math.max(ae, be, ce) - g.originE) / cellM));
    const iy0 = Math.max(0, Math.ceil((Math.min(an, bn, cn) - g.originN) / cellM));
    const iy1 = Math.min(ny - 1, Math.floor((Math.max(an, bn, cn) - g.originN) / cellM));
    for (let iy = iy0; iy <= iy1; iy++) {
      const y = g.originN + iy * cellM;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = g.originE + ix * cellM;
        const wb = ((x - ae) * (cn - an) - (ce - ae) * (y - an)) / det;
        const wc = ((be - ae) * (y - an) - (x - ae) * (bn - an)) / det;
        const wa = 1 - wb - wc;
        if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
        raise(iy * nx + ix, wa * au + wb * bu + wc * cu);
      }
    }
  }
}
