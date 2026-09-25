/**
 * Artificial zenith skyglow from VIIRS radiance, binned by azimuth sector and distance ring.
 * The GPU path (ui/sky/skyglowGl.ts) integrates the same kernel over the same bins; the sums here are the
 * exact per-pixel reference used by tests and calibration only.
 */

import { bortleOf, cdm2ToMag, magToCdm2, NATURAL_SKY_MAG, type Bortle } from './brightness';
import { VIIRS_PX_PER_DEG, VIIRS_SCALE, type ViirsWindow } from './viirs';

export const SECTORS = 36;
export const SECTOR_DEG = 360 / SECTORS;
/** Ring edges, km; fine near the observer where one pixel can dominate. */
export const RINGS_KM = [0, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 384] as const;
export const RINGS = RINGS_KM.length - 1;
export const REACH_KM = RINGS_KM[RINGS];
export const KM_PER_DEG_LAT = 110.574;
export const KM_PER_DEG_LON = 111.32;
/** Kernel softening, km: keeps an observer's own pixel finite. */
export const SOFTEN_KM = 1;
/** Aerosol scale height for dome elevation, km (DarkHours light_dome.py, MIT). */
export const DOME_SCALE_KM = 3;
/** A dome is a sector this many times brighter than an even share (DarkHours PROMINENCE_RATIO). */
export const DOME_PROMINENCE = 4;

export interface SkyglowParams {
  /** cd/m² per nW/(cm²·sr)·km² at unit kernel. */
  k: number;
  /** Extinction length, km. */
  lambdaKm: number;
}

/** Fitted by scripts/viirs/calibrate.ts against the SQM sites in skyglow.sites.ts. */
export const SKYGLOW_PARAMS: SkyglowParams = { k: 2.528e-5, lambdaKm: 19 };

// Walker's d^-2.5 law softened at the source and cut by extinction: a Garstang (1986) shape without its integral.
export const kernel = (dKm: number, lambdaKm: number): number => (dKm * dKm + SOFTEN_KM * SOFTEN_KM) ** -1.25 * Math.exp(-dKm / lambdaKm);

// Garstang (1986) molecular (0.104/km) and aerosol (0.657/km) scale heights, weighted equally.
export const altitudeFactor = (heightM: number): number => {
  const h = Math.max(0, heightM) / 1000;
  return 0.5 * (Math.exp(-0.104 * h) + Math.exp(-0.657 * h));
};

export const ringOf = (dKm: number): number => {
  for (let k = 0; k < RINGS; k++) if (dKm < RINGS_KM[k + 1]) return k;
  return -1;
};

/** Per sector × ring: Σ radiance·area·kernel (w) and the same weighted by distance (wd), row-major by ring. */
export interface GlowBins {
  w: Float64Array;
  wd: Float64Array;
}

export const emptyBins = (): GlowBins => ({ w: new Float64Array(SECTORS * RINGS), wd: new Float64Array(SECTORS * RINGS) });

/** Exact per-pixel sums of a window around an observer; the GPU samples the same integral. */
export function referenceBins(win: ViirsWindow, lat: number, lng: number, lambdaKm: number): GlowBins {
  const bins = emptyBins();
  const d2r = Math.PI / 180;
  const pxDeg = 1 / VIIRS_PX_PER_DEG;
  const kx = KM_PER_DEG_LON * Math.cos(lat * d2r);
  const scale = win.scale ?? VIIRS_SCALE;
  for (let r = 0; r < win.rows; r++) {
    const pLat = 90 - (win.row0 + r + 0.5) * pxDeg;
    const dy = (pLat - lat) * KM_PER_DEG_LAT;
    const area = pxDeg * KM_PER_DEG_LAT * pxDeg * KM_PER_DEG_LON * Math.cos(pLat * d2r);
    for (let c = 0; c < win.cols; c++) {
      const v = win.data[r * win.cols + c];
      if (!v) continue;
      let dLon = (win.col0 + c + 0.5) * pxDeg - 180 - lng;
      dLon -= 360 * Math.round(dLon / 360);
      const dx = dLon * kx;
      const d = Math.hypot(dx, dy);
      const k = ringOf(d);
      if (k < 0) continue;
      const az = (Math.atan2(dx, dy) / d2r + 360) % 360;
      const s = Math.floor(az / SECTOR_DEG) % SECTORS;
      const w = v * scale * area * kernel(d, lambdaKm);
      bins.w[k * SECTORS + s] += w;
      bins.wd[k * SECTORS + s] += w * d;
    }
  }
  return bins;
}

export interface Dome {
  azimuthDeg: number;
  /** Apparent height of the glow, degrees: atan(DOME_SCALE_KM / distance). */
  heightDeg: number;
  distanceKm: number;
  /** Fraction of all artificial zenith light from this sector. */
  share: number;
  /** Terrain skyline at this azimuth, degrees; null without a horizon profile. */
  skylineDeg: number | null;
  hidden: boolean;
}

export interface Skyglow {
  /** Artificial zenith luminance, cd/m². */
  artificialCdm2: number;
  /** Zenith sky including the natural background, mag/arcsec². */
  mag: number;
  bortle: Bortle;
  /** Share of the artificial light per sector, summing to 1 (all 0 with no light). */
  sectorShare: Float64Array;
  /** Glow-weighted mean source distance per sector, km. */
  sectorDistKm: Float64Array;
  domes: Dome[];
}

export interface GlowToward {
  /** Sector prominence at that altitude relative to an even share; ≥ DOME_PROMINENCE is a dome. */
  prominence: number;
  heightDeg: number;
  hidden: boolean;
}

/** From bins to a zenith brightness, per-direction shares and the main light domes. */
export function skyglowFrom(bins: GlowBins, heightM: number, p: SkyglowParams, skyline?: (azDeg: number) => number): Skyglow {
  const w = new Float64Array(SECTORS);
  const wd = new Float64Array(SECTORS);
  let total = 0;
  for (let k = 0; k < RINGS; k++)
    for (let s = 0; s < SECTORS; s++) {
      w[s] += bins.w[k * SECTORS + s];
      wd[s] += bins.wd[k * SECTORS + s];
    }
  for (const v of w) total += v;
  const artificialCdm2 = p.k * total * altitudeFactor(heightM);
  const mag = cdm2ToMag(magToCdm2(NATURAL_SKY_MAG) + artificialCdm2);
  const sectorShare = w.map((v) => (total > 0 ? v / total : 0));
  const sectorDistKm = w.map((v, s) => (v > 0 ? wd[s] / v : 0));
  return { artificialCdm2, mag, bortle: bortleOf(mag), sectorShare, sectorDistKm, domes: domesOf(sectorShare, sectorDistKm, skyline) };
}

// Tent-smoothed over neighbours, as DarkHours bins its dome sectors, so a city on a sector edge still reads as one dome.
const smoothed = (share: Float64Array) => share.map((v, s) => 0.5 * v + 0.25 * (share[(s + SECTORS - 1) % SECTORS] + share[(s + 1) % SECTORS]));

export const domeHeightDeg = (distKm: number): number => (Math.atan2(DOME_SCALE_KM, Math.max(distKm, 0.1)) * 180) / Math.PI;

export function domesOf(share: Float64Array, distKm: Float64Array, skyline?: (azDeg: number) => number, max = 3): Dome[] {
  const sm = smoothed(share);
  const out: Dome[] = [];
  for (let s = 0; s < SECTORS; s++) {
    const v = sm[s];
    if (v * SECTORS < DOME_PROMINENCE) continue;
    if (v < sm[(s + SECTORS - 1) % SECTORS] || v <= sm[(s + 1) % SECTORS]) continue;
    // Near sources light the zenith, not a horizon dome.
    if (distKm[s] < 2) continue;
    const azimuthDeg = (s + 0.5) * SECTOR_DEG;
    const heightDeg = domeHeightDeg(distKm[s]);
    const sky = skyline ? skyline(azimuthDeg) : null;
    out.push({ azimuthDeg, heightDeg, distanceKm: distKm[s], share: share[s], skylineDeg: sky, hidden: sky !== null && sky >= heightDeg });
  }
  return out.toSorted((a, b) => b.share - a.share).slice(0, max);
}

/** How strongly the glow shows toward one direction (DarkHours glow_toward: score / (1 + (alt/θ)²)). */
export function glowToward(g: Skyglow, azDeg: number, altDeg: number, skyline?: (azDeg: number) => number): GlowToward {
  const sm = smoothed(g.sectorShare);
  const s = Math.floor((((azDeg % 360) + 360) % 360) / SECTOR_DEG) % SECTORS;
  const heightDeg = domeHeightDeg(g.sectorDistKm[s]);
  const a = Math.max(0, altDeg);
  const hidden = skyline ? skyline(azDeg) >= Math.max(heightDeg, altDeg) : false;
  return { prominence: (sm[s] * SECTORS) / (1 + (a / heightDeg) ** 2), heightDeg, hidden };
}

