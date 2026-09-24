import { SearchSunLongitude, type Observer } from 'astronomy-engine';
import { airDensity } from './refraction';
import { apply, eqjToEnu, horizontalOf, type AzAlt } from './skyFrame';
import { eqjVector } from './stars';

export interface MeteorShower {
  /** IAU three-letter code. */
  code: string;
  name: string;
  /** Activity bounds as [month, day]; `to` before `from` wraps the year end. */
  from: [number, number];
  to: [number, number];
  /** Solar longitude at maximum, degrees; fixes the peak date each year. */
  peakLonDeg: number;
  /** Radiant at maximum, J2000 degrees, and its daily drift. */
  raDeg: number;
  decDeg: number;
  driftRaDeg: number;
  driftDecDeg: number;
  /** Geocentric velocity, km/s. */
  vKmS: number;
  /** Population index: 2.0 bright meteors, 3.0 faint. */
  r: number;
  /** Zenithal hourly rate at maximum; null when it varies from year to year. */
  zhr: number | null;
  parent: string | null;
}

/** IMO working list of visual meteor showers (major and regular minor showers). */
export const SHOWERS: MeteorShower[] = [
  { code: 'QUA', name: 'Quadrantids', from: [12, 28], to: [1, 12], peakLonDeg: 283.15, raDeg: 230, decDeg: 49, driftRaDeg: 0.8, driftDecDeg: -0.2, vKmS: 41, r: 2.1, zhr: 80, parent: '2003 EH1' },
  { code: 'ACE', name: 'α-Centaurids', from: [1, 31], to: [2, 20], peakLonDeg: 319.2, raDeg: 210, decDeg: -59, driftRaDeg: 1.1, driftDecDeg: -0.3, vKmS: 58, r: 2.0, zhr: 6, parent: null },
  { code: 'GNO', name: 'γ-Normids', from: [2, 25], to: [3, 28], peakLonDeg: 354, raDeg: 239, decDeg: -50, driftRaDeg: 1.0, driftDecDeg: 0, vKmS: 56, r: 2.4, zhr: 6, parent: null },
  { code: 'LYR', name: 'Lyrids', from: [4, 14], to: [4, 30], peakLonDeg: 32.32, raDeg: 271, decDeg: 34, driftRaDeg: 1.1, driftDecDeg: 0, vKmS: 49, r: 2.1, zhr: 18, parent: 'C/1861 G1 Thatcher' },
  { code: 'PPU', name: 'π-Puppids', from: [4, 15], to: [4, 28], peakLonDeg: 33.5, raDeg: 110, decDeg: -45, driftRaDeg: 0.8, driftDecDeg: 0, vKmS: 18, r: 2.0, zhr: null, parent: '26P/Grigg-Skjellerup' },
  { code: 'ETA', name: 'η-Aquariids', from: [4, 19], to: [5, 28], peakLonDeg: 45.5, raDeg: 338, decDeg: -1, driftRaDeg: 0.9, driftDecDeg: 0.4, vKmS: 66, r: 2.4, zhr: 50, parent: '1P/Halley' },
  { code: 'ELY', name: 'η-Lyrids', from: [5, 3], to: [5, 14], peakLonDeg: 50.0, raDeg: 287, decDeg: 44, driftRaDeg: 1.0, driftDecDeg: 0, vKmS: 43, r: 3.0, zhr: 3, parent: 'C/1983 H1 IRAS-Araki-Alcock' },
  { code: 'JBO', name: 'June Boötids', from: [6, 22], to: [7, 2], peakLonDeg: 95.7, raDeg: 224, decDeg: 48, driftRaDeg: 0.7, driftDecDeg: -0.2, vKmS: 18, r: 2.2, zhr: null, parent: '7P/Pons-Winnecke' },
  { code: 'CAP', name: 'α-Capricornids', from: [7, 3], to: [8, 15], peakLonDeg: 127, raDeg: 307, decDeg: -10, driftRaDeg: 0.9, driftDecDeg: 0.3, vKmS: 23, r: 2.5, zhr: 5, parent: '169P/NEAT' },
  { code: 'SDA', name: 'Southern δ-Aquariids', from: [7, 12], to: [8, 23], peakLonDeg: 127, raDeg: 340, decDeg: -16, driftRaDeg: 0.8, driftDecDeg: 0.3, vKmS: 41, r: 2.5, zhr: 25, parent: '96P/Machholz' },
  { code: 'PAU', name: 'Piscis Austrinids', from: [7, 15], to: [8, 10], peakLonDeg: 125, raDeg: 341, decDeg: -30, driftRaDeg: 1.0, driftDecDeg: 0.4, vKmS: 35, r: 3.2, zhr: 5, parent: null },
  { code: 'PER', name: 'Perseids', from: [7, 17], to: [8, 24], peakLonDeg: 140.0, raDeg: 48, decDeg: 58, driftRaDeg: 1.4, driftDecDeg: 0.1, vKmS: 59, r: 2.2, zhr: 100, parent: '109P/Swift-Tuttle' },
  { code: 'KCG', name: 'κ-Cygnids', from: [8, 3], to: [8, 25], peakLonDeg: 145, raDeg: 286, decDeg: 59, driftRaDeg: 0.4, driftDecDeg: 0.1, vKmS: 25, r: 3.0, zhr: 3, parent: null },
  { code: 'AUR', name: 'Aurigids', from: [8, 28], to: [9, 5], peakLonDeg: 158.6, raDeg: 91, decDeg: 39, driftRaDeg: 1.0, driftDecDeg: 0, vKmS: 66, r: 2.5, zhr: 6, parent: 'C/1911 N1 Kiess' },
  { code: 'SPE', name: 'September ε-Perseids', from: [9, 5], to: [9, 21], peakLonDeg: 166.7, raDeg: 48, decDeg: 40, driftRaDeg: 1.1, driftDecDeg: 0.2, vKmS: 64, r: 3.0, zhr: 5, parent: null },
  { code: 'STA', name: 'Southern Taurids', from: [9, 10], to: [11, 20], peakLonDeg: 197, raDeg: 32, decDeg: 9, driftRaDeg: 0.8, driftDecDeg: 0.2, vKmS: 27, r: 2.3, zhr: 5, parent: '2P/Encke' },
  { code: 'OCT', name: 'October Camelopardalids', from: [10, 5], to: [10, 6], peakLonDeg: 192.6, raDeg: 164, decDeg: 79, driftRaDeg: 0, driftDecDeg: 0, vKmS: 47, r: 2.5, zhr: 5, parent: null },
  { code: 'DRA', name: 'Draconids', from: [10, 6], to: [10, 10], peakLonDeg: 195.4, raDeg: 262, decDeg: 54, driftRaDeg: 0, driftDecDeg: 0, vKmS: 20, r: 2.6, zhr: 10, parent: '21P/Giacobini-Zinner' },
  { code: 'EGE', name: 'ε-Geminids', from: [10, 14], to: [10, 27], peakLonDeg: 206, raDeg: 102, decDeg: 27, driftRaDeg: 1.0, driftDecDeg: 0, vKmS: 70, r: 3.0, zhr: 3, parent: null },
  { code: 'ORI', name: 'Orionids', from: [10, 2], to: [11, 7], peakLonDeg: 208, raDeg: 95, decDeg: 16, driftRaDeg: 0.7, driftDecDeg: 0.1, vKmS: 66, r: 2.5, zhr: 20, parent: '1P/Halley' },
  { code: 'LMI', name: 'Leonis Minorids', from: [10, 19], to: [10, 27], peakLonDeg: 209, raDeg: 162, decDeg: 37, driftRaDeg: 1.0, driftDecDeg: -0.4, vKmS: 62, r: 3.0, zhr: 2, parent: 'C/1739 K1' },
  { code: 'NTA', name: 'Northern Taurids', from: [10, 20], to: [12, 10], peakLonDeg: 230, raDeg: 58, decDeg: 22, driftRaDeg: 0.8, driftDecDeg: 0.2, vKmS: 29, r: 2.3, zhr: 5, parent: '2P/Encke' },
  { code: 'LEO', name: 'Leonids', from: [11, 6], to: [11, 30], peakLonDeg: 235.27, raDeg: 152, decDeg: 22, driftRaDeg: 0.7, driftDecDeg: -0.4, vKmS: 71, r: 2.5, zhr: 15, parent: '55P/Tempel-Tuttle' },
  { code: 'AMO', name: 'α-Monocerotids', from: [11, 15], to: [11, 25], peakLonDeg: 239.32, raDeg: 117, decDeg: 1, driftRaDeg: 1.0, driftDecDeg: 0, vKmS: 65, r: 2.4, zhr: null, parent: null },
  { code: 'NOO', name: 'November Orionids', from: [11, 13], to: [12, 6], peakLonDeg: 246, raDeg: 91, decDeg: 16, driftRaDeg: 0.8, driftDecDeg: 0, vKmS: 44, r: 3.0, zhr: 3, parent: null },
  { code: 'PHO', name: 'Phoenicids', from: [11, 28], to: [12, 9], peakLonDeg: 254, raDeg: 18, decDeg: -53, driftRaDeg: 0.8, driftDecDeg: 0, vKmS: 18, r: 2.8, zhr: null, parent: 'D/1819 W1 Blanpain' },
  { code: 'PUP', name: 'Puppid-Velids', from: [12, 1], to: [12, 15], peakLonDeg: 255, raDeg: 123, decDeg: -45, driftRaDeg: 0.7, driftDecDeg: 0, vKmS: 40, r: 2.9, zhr: 10, parent: null },
  { code: 'MON', name: 'December Monocerotids', from: [12, 5], to: [12, 20], peakLonDeg: 257, raDeg: 100, decDeg: 8, driftRaDeg: 1.0, driftDecDeg: 0, vKmS: 41, r: 3.0, zhr: 3, parent: 'C/1917 F1 Mellish' },
  { code: 'HYD', name: 'σ-Hydrids', from: [12, 3], to: [12, 20], peakLonDeg: 255, raDeg: 127, decDeg: 2, driftRaDeg: 0.7, driftDecDeg: -0.2, vKmS: 58, r: 3.0, zhr: 7, parent: null },
  { code: 'GEM', name: 'Geminids', from: [12, 4], to: [12, 20], peakLonDeg: 262.2, raDeg: 112, decDeg: 33, driftRaDeg: 1.0, driftDecDeg: -0.1, vKmS: 35, r: 2.6, zhr: 150, parent: '3200 Phaethon' },
  { code: 'COM', name: 'Comae Berenicids', from: [12, 12], to: [1, 23], peakLonDeg: 268, raDeg: 175, decDeg: 18, driftRaDeg: 0.9, driftDecDeg: -0.3, vKmS: 65, r: 3.0, zhr: 3, parent: null },
  { code: 'DLM', name: 'December Leonis Minorids', from: [12, 5], to: [2, 4], peakLonDeg: 282, raDeg: 161, decDeg: 30, driftRaDeg: 1.0, driftDecDeg: -0.4, vKmS: 64, r: 3.0, zhr: 5, parent: null },
  { code: 'URS', name: 'Ursids', from: [12, 17], to: [12, 26], peakLonDeg: 270.7, raDeg: 217, decDeg: 76, driftRaDeg: 0, driftDecDeg: 0, vKmS: 33, r: 3.0, zhr: 10, parent: '8P/Tuttle' }
];

const DAY_MS = 86_400_000;

/** Instant of maximum in a given year: when the Sun reaches the shower's solar longitude. */
export function peakTime(shower: MeteorShower, year: number): Date {
  const t = SearchSunLongitude(shower.peakLonDeg, new Date(Date.UTC(year, 0, 1)), 370);
  if (!t) throw new Error(`no maximum for ${shower.code} in ${year}`);
  return t.date;
}

export interface ShowerStatus {
  shower: MeteorShower;
  peakMs: number;
  /** Activity bounds (UTC day granularity). */
  startMs: number;
  endMs: number;
  active: boolean;
  /** Days from the peak; negative before it. */
  daysFromPeak: number;
  /** Where the year-wrapping activity is anchored. */
  year: number;
}

function bounds(shower: MeteorShower, year: number): { startMs: number; endMs: number } {
  const startMs = Date.UTC(year, shower.from[0] - 1, shower.from[1]);
  let endMs = Date.UTC(year, shower.to[0] - 1, shower.to[1]) + DAY_MS;
  if (endMs <= startMs) endMs = Date.UTC(year + 1, shower.to[0] - 1, shower.to[1]) + DAY_MS;
  return { startMs, endMs };
}

/** The shower's apparition nearest to `timeMs`; wrapping showers are anchored at their start year. */
export function showerStatus(shower: MeteorShower, timeMs: number): ShowerStatus {
  const y = new Date(timeMs).getUTCFullYear();
  let best: ShowerStatus | null = null;
  for (const year of [y - 1, y, y + 1]) {
    const { startMs, endMs } = bounds(shower, year);
    const peakYear = shower.from[0] > shower.to[0] && shower.peakLonDeg < 180 ? year + 1 : year;
    const peakMs = peakTime(shower, peakYear).getTime();
    const s: ShowerStatus = { shower, peakMs, startMs, endMs, active: timeMs >= startMs && timeMs < endMs, daysFromPeak: (timeMs - peakMs) / DAY_MS, year };
    if (!best || Math.abs(s.daysFromPeak) < Math.abs(best.daysFromPeak)) best = s;
  }
  return best!;
}

/** Radiant position at a time: the peak radiant drifted by the days since maximum. */
export function radiantEquatorial(status: ShowerStatus): { raDeg: number; decDeg: number } {
  const d = status.daysFromPeak;
  return { raDeg: (((status.shower.raDeg + status.shower.driftRaDeg * d) % 360) + 360) % 360, decDeg: Math.max(-90, Math.min(90, status.shower.decDeg + status.shower.driftDecDeg * d)) };
}

export function radiantHorizontal(status: ShowerStatus, timeMs: number, obs: Observer): AzAlt {
  const { raDeg, decDeg } = radiantEquatorial(status);
  const [x, y, z] = eqjVector(raDeg, decDeg);
  const out = new Float64Array(3);
  apply(eqjToEnu(new Date(timeMs), obs), x, y, z, out);
  return horizontalOf(out[0], out[1], out[2], airDensity(obs.height));
}

/** Showers active at the time, strongest first. */
export function activeShowers(timeMs: number): ShowerStatus[] {
  return SHOWERS.map((s) => showerStatus(s, timeMs))
    .filter((s) => s.active)
    .toSorted((a, b) => (b.shower.zhr ?? 0) - (a.shower.zhr ?? 0));
}

/** Peaks falling within the next `days`, soonest first. */
export function upcomingPeaks(timeMs: number, days = 120): ShowerStatus[] {
  const horizon = timeMs + days * DAY_MS;
  return SHOWERS.map((s) => showerStatus(s, timeMs))
    .filter((s) => s.peakMs >= timeMs && s.peakMs <= horizon)
    .toSorted((a, b) => a.peakMs - b.peakMs);
}
