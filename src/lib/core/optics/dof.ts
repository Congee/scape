export interface DepthOfField {
  hyperfocalM: number;
  nearM: number;
  /** Infinity when the far limit is beyond the hyperfocal distance. */
  farM: number;
  totalM: number;
}

export function hyperfocalM(focalMm: number, fNumber: number, cocMm: number): number {
  return ((focalMm * focalMm) / (fNumber * cocMm) + focalMm) / 1000;
}

/** Thin-lens depth of field for a subject at `focusDistM`. */
export function depthOfField(focalMm: number, fNumber: number, cocMm: number, focusDistM: number): DepthOfField {
  const f = focalMm;
  const H = hyperfocalM(focalMm, fNumber, cocMm) * 1000;
  const s = Math.max(focusDistM * 1000, f + 1e-6);
  const nearM = (s * (H - f)) / (H + s - 2 * f) / 1000;
  const farM = s >= H ? Infinity : (s * (H - f)) / (H - s) / 1000;
  return { hyperfocalM: H / 1000, nearM, farM, totalM: farM - nearM };
}

export interface Panorama {
  shots: number;
  /** Yaw between consecutive frames, degrees. */
  stepDeg: number;
  /** Angle actually covered by the frames, degrees. */
  coveredDeg: number;
}

/** Frames needed to cover `totalDeg` with frames `shotDeg` wide overlapping by `overlap` of a frame. */
export function panoramaShots(totalDeg: number, shotDeg: number, overlap = 0.3): Panorama {
  const advance = shotDeg * (1 - overlap);
  const shots = totalDeg <= shotDeg ? 1 : Math.ceil((totalDeg - shotDeg) / advance - 1e-9) + 1;
  const stepDeg = shots > 1 ? (totalDeg - shotDeg) / (shots - 1) : 0;
  return { shots, stepDeg, coveredDeg: shots === 1 ? shotDeg : totalDeg };
}

/** Angle covered by `shots` frames `shotDeg` wide at the given overlap. */
export function panoramaCoverageDeg(shots: number, shotDeg: number, overlap = 0.3): number {
  return Math.min(360, shotDeg + (shots - 1) * shotDeg * (1 - overlap));
}
