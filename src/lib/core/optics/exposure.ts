/** Exposure value at ISO 100: EV100 = log2(N² / t) − log2(S / 100). */
export function ev100(fNumber: number, shutterS: number, iso: number): number {
  return Math.log2((fNumber * fNumber) / shutterS) - Math.log2(iso / 100);
}

export function apertureFor(ev: number, shutterS: number, iso: number): number {
  return Math.sqrt(shutterS * 2 ** (ev + Math.log2(iso / 100)));
}

export function shutterFor(ev: number, fNumber: number, iso: number): number {
  return (fNumber * fNumber) / 2 ** (ev + Math.log2(iso / 100));
}

export function isoFor(ev: number, fNumber: number, shutterS: number): number {
  return 100 * 2 ** (Math.log2((fNumber * fNumber) / shutterS) - ev);
}

/** Nominal 1/3-stop camera markings. */
export const SHUTTER_THIRDS_S = [
  30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3.2, 2.5, 2, 1.6, 1.3, 1, 0.8, 0.6, 0.5, 0.4, 0.3, 1 / 4, 1 / 5, 1 / 6, 1 / 8, 1 / 10, 1 / 13, 1 / 15, 1 / 20, 1 / 25, 1 / 30, 1 / 40, 1 / 50, 1 / 60, 1 / 80, 1 / 100, 1 / 125,
  1 / 160, 1 / 200, 1 / 250, 1 / 320, 1 / 400, 1 / 500, 1 / 640, 1 / 800, 1 / 1000, 1 / 1250, 1 / 1600, 1 / 2000, 1 / 2500, 1 / 3200, 1 / 4000, 1 / 5000, 1 / 6400, 1 / 8000
];
export const APERTURE_THIRDS = [1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32];
export const ISO_THIRDS = [
  50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600, 32000, 40000, 51200, 64000, 80000, 102400
];

/** Closest marking in stops (log space), or null outside the table by more than half a third. */
export function nearestNominal(value: number, table: readonly number[]): number | null {
  if (!(value > 0)) return null;
  let best = table[0];
  for (const v of table) if (Math.abs(Math.log2(v / value)) < Math.abs(Math.log2(best / value))) best = v;
  return Math.abs(Math.log2(best / value)) <= 1 / 6 + 1e-9 ? best : null;
}

/** Camera-style shutter label: 1/250, 0.6 s, 30 s, 4 min 16 s. */
export function formatShutter(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—';
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min`;
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = Math.round(s - m * 60);
    return r === 60 ? `${m + 1} min` : r ? `${m} min ${r} s` : `${m} min`;
  }
  if (s >= 0.3) return `${s >= 10 ? Math.round(s) : Number(s.toFixed(1))} s`;
  return `1/${Math.round(1 / s)}`;
}

/** Parses 1/250, 0.5, 2", 30s or 4m into seconds. */
export function parseShutter(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '').replace(/(sec|s|")$/i, '');
  const frac = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]) || null;
  const min = /^(\d+(?:\.\d+)?)(m|min)$/i.exec(t);
  if (min) return Number(min[1]) * 60 || null;
  const n = Number(t);
  return t !== '' && n > 0 ? n : null;
}

const LOG10_2 = Math.log10(2);

export const ndFactor = (stops: number) => 2 ** stops;
export const ndStops = (factor: number) => Math.log2(factor);
export const ndOpticalDensity = (stops: number) => stops * LOG10_2;
export const ndStopsFromDensity = (od: number) => od / LOG10_2;
export const ndShutter = (baseS: number, stops: number) => baseS * 2 ** stops;

export interface NdFilter {
  name: string;
  factor: number;
}

export const ND_FILTERS: NdFilter[] = [
  { name: 'ND2', factor: 2 },
  { name: 'ND4', factor: 4 },
  { name: 'ND8', factor: 8 },
  { name: 'ND16', factor: 16 },
  { name: 'ND32', factor: 32 },
  { name: 'ND64', factor: 64 },
  { name: 'ND100', factor: 100 },
  { name: 'ND400', factor: 400 },
  { name: 'ND1000', factor: 1000 },
  { name: 'ND32000', factor: 32_000 },
  { name: 'ND1M', factor: 1_000_000 }
];

export interface SceneEv {
  label: string;
  /** Middle of the tabulated range, EV100. */
  ev: number;
  lo: number;
  hi: number;
  /** Interpolated between table rows rather than read from one. */
  estimate: boolean;
}

export interface SceneWorld {
  sunAltDeg: number;
  moonAltDeg: number;
  moonIllumination: number;
  /** What a lunar eclipse leaves of the moon's light, 0..1; 1 when absent. */
  moonEclipse?: number;
}

const row = (label: string, lo: number, hi = lo, estimate = false): SceneEv => ({ label, ev: (lo + hi) / 2, lo, hi, estimate });

const MOON_TABLE_ALT = 40;
const MILKY_WAY = row('Starlight, Milky Way core', -11, -9);

function moonlight(w: SceneWorld): SceneEv | null {
  if (w.moonAltDeg <= 0 || w.moonIllumination < 0.05) return null;
  const f = w.moonIllumination;
  const base = f > 0.9 ? row('Full moonlight', -3, -2) : f > 0.6 ? row('Gibbous moonlight', -4) : f > 0.35 ? row('Quarter moonlight', -6) : row('Crescent moonlight', -8, -8, true);
  const e = eclipseStops(w);
  if (w.moonAltDeg >= MOON_TABLE_ALT && e === 0) return base;
  // Below the table's 40° the ground light falls roughly with sin(altitude).
  const d = w.moonAltDeg >= MOON_TABLE_ALT ? 0 : Math.log2(Math.sin((w.moonAltDeg * Math.PI) / 180) / Math.sin((MOON_TABLE_ALT * Math.PI) / 180));
  const label = `${base.label}${d < 0 ? ', moon low' : ''}${e < 0 ? ', eclipsed' : ''}`;
  const low = row(label, base.lo + d + e, base.hi + d + e, true);
  return low.hi > MILKY_WAY.hi ? low : null;
}

/** Stops a lunar eclipse takes off the moon and its light. */
const eclipseStops = (w: SceneWorld) => Math.log2(Math.max(w.moonEclipse ?? 1, 1e-6));

/**
 * Tabulated EV100 for the light at this sun and moon position (ANSI PH2.7 via
 * Wikipedia "Exposure value" Table 2), best first. Twilight is interpolated.
 */
export function sceneExposure(w: SceneWorld): SceneEv[] {
  const out: SceneEv[] = [];
  const s = w.sunAltDeg;
  if (s >= 20) out.push(row('Full sun, front-lit', 15), row('Hazy sun', 14), row('Cloudy bright', 13), row('Heavy overcast or open shade', 12), row('Snow or sand in sun', 16));
  else if (s >= 5) out.push(row('Low sun', 13, 14, true), row('Cloudy bright', 12, 12, true));
  else if (s >= 1) out.push(row('Just before sunset', 12, 14));
  else if (s >= -2) out.push(row('At sunset', 12));
  else if (s >= -6) out.push(row('Just after sunset', 9, 11));
  else if (s >= -18) {
    // 9 at civil dusk down to the dark-sky −9 at astronomical dusk.
    const ev = 9 + ((s + 6) / 12) * 18;
    out.push(row('Twilight', ev - 1, ev + 1, true));
  }
  const moon = s < -6 ? moonlight(w) : null;
  if (s < -18) out.push(moon ?? MILKY_WAY);
  else if (moon && moon.ev > out[0].ev) out.unshift(moon);
  if (s < -18 && moon) out.push(MILKY_WAY);
  if (s > 0 && s < 42) out.push(row('Rainbow, clear sky behind', 15), row('Rainbow, cloudy sky behind', 14));
  if (w.moonAltDeg > 0) {
    const f = w.moonIllumination;
    const disc = f > 0.9 ? row('Moon disc, full', 15) : f > 0.6 ? row('Moon disc, gibbous', 14) : f > 0.35 ? row('Moon disc, quarter', 13) : row('Moon disc, crescent', 12);
    const e = eclipseStops(w);
    out.push(e < 0 ? row(`${disc.label}, eclipsed`, disc.lo + e, disc.hi + e, true) : disc);
  }
  return out;
}

/** Tabulated EV100 converted to the EV a meter at `iso` would show. */
export const evAtIso = (ev100Value: number, iso: number) => ev100Value + Math.log2(iso / 100);
