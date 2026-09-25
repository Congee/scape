import { AstroTime, Body, C_AUDAY, EclipseKind, GeoMoon, GeoVector, ObserverVector, Search, SearchLocalSolarEclipse, SearchLunarEclipse, type LocalSolarEclipseInfo, type LunarEclipseInfo, type Observer } from 'astronomy-engine';
import { horizonAngleAt, type HorizonProfile } from '@core/terrain/horizon';
import { besselianHours, besselianLocal, besselianTime, type BesselianElements } from './besselian';
import { SkyBody } from './bodies';
import { position } from './positions';
import { SEMIDIAMETER_DEG } from './terrainEvents';

/** Contacts in NASA's naming: C1–C4 for the sun, P1/U1–U4/P4 for the moon. */
export const ContactKind = {
  C1: 'C1',
  C2: 'C2',
  C3: 'C3',
  C4: 'C4',
  P1: 'P1',
  U1: 'U1',
  U2: 'U2',
  U3: 'U3',
  U4: 'U4',
  P4: 'P4',
  Max: 'Max'
} as const;
export type ContactKind = (typeof ContactKind)[keyof typeof ContactKind];

export interface EclipseContact {
  kind: ContactKind;
  timeMs: number;
  /** Apparent altitude of the body's centre, degrees. */
  altitude: number;
  azimuth: number;
  /** Terrain skyline angle at the body's azimuth; null without a swept horizon. */
  skylineDeg: number | null;
  /** Upper limb above the skyline, or above the sea-level horizon without one. */
  visible: boolean;
}

/** Where solar contacts come from: NASA's Besselian elements (2000–2100), or astronomy-engine's ephemeris elsewhere. */
export const SolarSource = { Besselian: 'Besselian', Ephemeris: 'Ephemeris' } as const;
export type SolarSource = (typeof SolarSource)[keyof typeof SolarSource];

export interface SolarCircumstances {
  kind: EclipseKind;
  source: SolarSource;
  /** NASA convention: fraction of the sun's diameter covered, or the moon/sun size ratio when central. */
  magnitude: number;
  /** Fraction of the sun's area covered at maximum. */
  obscuration: number;
  contacts: EclipseContact[];
}

export interface LunarCircumstances {
  kind: EclipseKind;
  umbralMagnitude: number;
  penumbralMagnitude: number;
  contacts: EclipseContact[];
}

const KM_PER_AU = 149_597_870.7;
const EARTH_EQ_KM = 6378.137;
// NASA's solar radius, 959.63" at 1 AU (Five Millennium Canon).
const SUN_RADIUS_KM = (959.63 / 206_264.806) * KM_PER_AU;
// NASA's two lunar radii: mean limb for C1/C4, valleys (0.272281) for C2/C3.
const MOON_K_PENUMBRA = 0.2725076;
const MOON_K_UMBRA = 0.272281;
const MOON_RADIUS_KM = MOON_K_PENUMBRA * EARTH_EQ_KM;
const SEARCH_TOLERANCE_S = 0.01;

function contact(body: SkyBody, kind: ContactKind, timeMs: number, obs: Observer, horizon?: HorizonProfile): EclipseContact {
  const p = position(body, new Date(timeMs), obs);
  const skylineDeg = horizon ? horizonAngleAt(horizon, p.azimuth) : null;
  return { kind, timeMs, altitude: p.altitude, azimuth: p.azimuth, skylineDeg, visible: p.altitude + SEMIDIAMETER_DEG[body] > (skylineDeg ?? 0) };
}

/** Moon's shadow at the observer, km: distance from the axis, penumbral radius, umbral radius (negative past the apex). */
interface MoonShadow {
  r: number;
  p: number;
  k: number;
}

function moonShadow(t: AstroTime, obs: Observer): MoonShadow {
  const o = ObserverVector(t, obs, false);
  const s = GeoVector(Body.Sun, t, true);
  const m0 = GeoMoon(t);
  // The sun above is apparent; the moon needs its own ~1.3 s light time to match.
  const m = GeoMoon(t.AddDays(-Math.hypot(m0.x - o.x, m0.y - o.y, m0.z - o.z) / C_AUDAY));
  const d = [m.x - s.x, m.y - s.y, m.z - s.z];
  const q = [o.x - m.x, o.y - m.y, o.z - m.z];
  const u = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / (d[0] ** 2 + d[1] ** 2 + d[2] ** 2);
  const r = KM_PER_AU * Math.hypot(u * d[0] - q[0], u * d[1] - q[1], u * d[2] - q[2]);
  const p = -SUN_RADIUS_KM + (1 + u) * (SUN_RADIUS_KM + MOON_K_PENUMBRA * EARTH_EQ_KM);
  const k = SUN_RADIUS_KM - (1 + u) * (SUN_RADIUS_KM - MOON_K_UMBRA * EARTH_EQ_KM);
  return { r, p, k };
}

/** NASA's magnitude: diameter fraction covered, or the moon/sun ratio when central. */
function shadowMagnitude({ r, p, k }: MoonShadow): number {
  return r < Math.abs(k) ? (p + k) / (p - k) : Math.max(0, (p - r) / (p - k));
}

/** NASA JSEX's covered area fraction for the same shadow. */
function shadowObscuration(sh: MoonShadow): number {
  const { r, p, k } = sh;
  const ratio = (p + k) / (p - k);
  if (r < Math.abs(k)) return k > 0 ? 1 : ratio * ratio;
  if (r >= p) return 0;
  const c = Math.acos((p * p + k * k - 2 * r * r) / (p * p - k * k));
  const b = Math.acos((-p * k + r * r) / r / (p - k));
  return (ratio * ratio * (Math.PI - b - c) + b - ratio * Math.sin(c)) / Math.PI;
}

/** Topocentric solar eclipse magnitude at one instant, NASA convention. */
export function solarMagnitude(date: Date, obs: Observer): number {
  return shadowMagnitude(moonShadow(new AstroTime(date), obs));
}

const near = (t: AstroTime, minutes: number) => t.AddDays(minutes / 1440);

function searchOrThrow(f: (t: AstroTime) => number, t1: AstroTime, t2: AstroTime): AstroTime {
  const t = Search(f, t1, t2, { dt_tolerance_seconds: SEARCH_TOLERANCE_S });
  if (!t) throw new Error(`eclipse contact search failed near ${t1.date.toISOString()}`);
  return t;
}

// Greatest eclipse and a local maximum lie within a few hours of each other.
const ELEMENTS_WINDOW_H = 4;

function besselianCircumstances(el: BesselianElements, obs: Observer, peak: AstroTime, horizon?: HorizonProfile): SolarCircumstances | null {
  const deltaTs = (peak.tt - peak.ut) * 86_400;
  const l = besselianLocal(el, obs, deltaTs);
  if (!l) return null;
  const at: MoonShadow = { r: l.m, p: l.L1, k: -l.L2 };
  const times: [ContactKind, number | null][] = [
    [ContactKind.C1, l.c1],
    [ContactKind.C2, l.c2],
    [ContactKind.Max, l.max],
    [ContactKind.C3, l.c3],
    [ContactKind.C4, l.c4]
  ];
  const contacts = times.flatMap(([kind, t]) => (t === null ? [] : [contact(SkyBody.Sun, kind, besselianTime(el, t).date.getTime(), obs, horizon)]));
  const kind = l.c2 === null ? EclipseKind.Partial : l.L2 < 0 ? EclipseKind.Total : EclipseKind.Annular;
  return { kind, source: SolarSource.Besselian, magnitude: shadowMagnitude(at), obscuration: shadowObscuration(at), contacts };
}

/**
 * Local circumstances of the first solar eclipse whose peak falls after `fromMs`, as seen from `obs`.
 * With NASA's Besselian elements for it in `elements`, contacts come from them; otherwise from the ephemeris.
 */
export function solarCircumstances(obs: Observer, fromMs: number, horizon?: HorizonProfile, elements?: readonly BesselianElements[]): SolarCircumstances {
  const e = SearchLocalSolarEclipse(new Date(fromMs), obs);
  const el = elements?.find((x) => Math.abs(besselianHours(x, e.peak.time)) < ELEMENTS_WINDOW_H);
  return (el && besselianCircumstances(el, obs, e.peak.time, horizon)) ?? ephemerisCircumstances(obs, e, horizon);
}

/** Fallback outside the elements: astronomy-engine's ephemeris, contacts re-solved with NASA's radii (seconds off NASA). */
function ephemerisCircumstances(obs: Observer, e: LocalSolarEclipseInfo, horizon?: HorizonProfile): SolarCircumstances {
  const sh = (t: AstroTime) => moonShadow(t, obs);
  const slope = (t: AstroTime) => sh(t.AddDays(1 / 86_400)).r - sh(t.AddDays(-1 / 86_400)).r;
  const peak = searchOrThrow(slope, near(e.peak.time, -10), near(e.peak.time, 10));
  const at = sh(peak);
  const c1 = searchOrThrow((t) => sh(t).p - sh(t).r, near(e.partial_begin.time, -10), peak);
  const c4 = searchOrThrow((t) => sh(t).r - sh(t).p, peak, near(e.partial_end.time, 10));
  const central = at.r < Math.abs(at.k);
  const times: [ContactKind, AstroTime][] = [[ContactKind.C1, c1]];
  if (central) times.push([ContactKind.C2, searchOrThrow((t) => Math.abs(sh(t).k) - sh(t).r, near(peak, -10), peak)]);
  times.push([ContactKind.Max, peak]);
  if (central) times.push([ContactKind.C3, searchOrThrow((t) => sh(t).r - Math.abs(sh(t).k), peak, near(peak, 10))]);
  times.push([ContactKind.C4, c4]);
  const contacts = times.map(([kind, t]) => contact(SkyBody.Sun, kind, t.date.getTime(), obs, horizon));
  const kind = !central ? EclipseKind.Partial : at.k > 0 ? EclipseKind.Total : EclipseKind.Annular;
  return { kind, source: SolarSource.Ephemeris, magnitude: shadowMagnitude(at), obscuration: shadowObscuration(at), contacts };
}

/** Earth's shadow at the moon, geocentric radians: the moon's distance from the axis, the two shadow radii, the moon's semidiameter. */
interface EarthShadow {
  g: number;
  rp: number;
  ru: number;
  sM: number;
}

type V3 = [number, number, number];
const ARCSEC = Math.PI / 648_000;
const angle = (a: V3, b: V3) => Math.atan2(Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);

function earthShadowAt(s: V3, m: V3): EarthShadow {
  const sunAu = Math.hypot(...s);
  const moonKm = Math.hypot(...m) * KM_PER_AU;
  // NASA's Danjon rule: the Earth's parallax enlarged 1% for the atmosphere.
  const piM = 1.01 * Math.asin(EARTH_EQ_KM / moonKm);
  const piS = (8.794143 * ARCSEC) / sunAu;
  const sS = (959.63 * ARCSEC) / sunAu;
  return { g: angle(m, [-s[0], -s[1], -s[2]]), rp: piM + piS + sS, ru: piM + piS - sS, sM: Math.asin(MOON_RADIUS_KM / moonKm) };
}

function sunMoon(t: AstroTime): { s: V3; m: V3 } {
  const s = GeoVector(Body.Sun, t, true);
  const m = GeoMoon(t);
  return { s: [s.x, s.y, s.z], m: [m.x, m.y, m.z] };
}

function earthShadow(t: AstroTime): EarthShadow {
  const { s, m } = sunMoon(t);
  return earthShadowAt(s, m);
}

/** Geocentric umbral and penumbral magnitudes, NASA's Danjon convention. */
export function lunarMagnitudes(date: Date): { umbral: number; penumbral: number } {
  const { g, rp, ru, sM } = earthShadow(new AstroTime(date));
  return { umbral: (ru + sM - g) / (2 * sM), penumbral: (rp + sM - g) / (2 * sM) };
}

/** Contacts of the first lunar eclipse whose peak falls after `fromMs`, with the moon's place as seen from `obs`. */
export function lunarCircumstances(obs: Observer, fromMs: number, horizon?: HorizonProfile): LunarCircumstances {
  // astronomy-engine finds the eclipse; contacts are re-solved with NASA's shadow.
  const { kind, at, times } = lunarContacts(SearchLunarEclipse(new Date(fromMs)));
  const contacts = times.map(([k, t]) => contact(SkyBody.Moon, k, t.date.getTime(), obs, horizon));
  return { kind, umbralMagnitude: (at.ru + at.sM - at.g) / (2 * at.sM), penumbralMagnitude: (at.rp + at.sM - at.g) / (2 * at.sM), contacts };
}

// Totality lasts under 1 h 47 min, so its start is within an hour of the peak.
const TOTALITY_HALF_MAX_MS = 3_600_000;

/** Totality (U2–U3, the whole disc in the umbra) overlapping `startMs`..`endMs`, or null. */
export function lunarTotality(startMs: number, endMs: number): { startMs: number; endMs: number } | null {
  const e = SearchLunarEclipse(new Date(startMs - TOTALITY_HALF_MAX_MS));
  if (e.kind !== EclipseKind.Total || e.peak.date.getTime() > endMs + TOTALITY_HALF_MAX_MS) return null;
  const { times } = lunarContacts(e);
  const u2 = times.find(([k]) => k === ContactKind.U2)?.[1].date.getTime();
  const u3 = times.find(([k]) => k === ContactKind.U3)?.[1].date.getTime();
  if (u2 === undefined || u3 === undefined || u3 <= startMs || u2 >= endMs) return null;
  return { startMs: u2, endMs: u3 };
}

function lunarContacts(e: LunarEclipseInfo): { kind: EclipseKind; at: EarthShadow; times: [ContactKind, AstroTime][] } {
  const slope = (t: AstroTime) => earthShadow(t.AddDays(1 / 86_400)).g - earthShadow(t.AddDays(-1 / 86_400)).g;
  const peak = searchOrThrow(slope, near(e.peak, -30), near(e.peak, 30));
  const at = earthShadow(peak);
  const edges: [ContactKind, ContactKind, (x: EarthShadow) => number][] = [
    [ContactKind.P1, ContactKind.P4, (x) => x.rp + x.sM],
    [ContactKind.U1, ContactKind.U4, (x) => x.ru + x.sM],
    [ContactKind.U2, ContactKind.U3, (x) => x.ru - x.sM]
  ];
  const live = edges.filter(([, , f]) => f(at) > at.g);
  const before = live.map(([k, , f]): [ContactKind, AstroTime] => [k, searchOrThrow((t) => f(earthShadow(t)) - earthShadow(t).g, peak.AddDays(-0.2), peak)]);
  const after = live.map(([, k, f]): [ContactKind, AstroTime] => [k, searchOrThrow((t) => earthShadow(t).g - f(earthShadow(t)), peak, peak.AddDays(0.2))]);
  const times = [...before, [ContactKind.Max, peak] as [ContactKind, AstroTime], ...after.toReversed()];
  const kind = live.length === 3 ? EclipseKind.Total : live.length === 2 ? EclipseKind.Partial : EclipseKind.Penumbral;
  return { kind, at, times };
}

// Refracted light in the umbra: ~1e-4 of full at the axis, 20× that at the edge (Danjon L≈2).
export const UMBRA_AXIS_LIGHT = 1e-4;
export const UMBRA_RISE = Math.log(20);

/** Unobscured fraction of the sun's disc behind a disc `e` times its radius, centres `d` sun radii apart. */
function sunVisible(e: number, d: number): number {
  if (d <= e - 1) return 0;
  if (d >= e + 1) return 1;
  const a = Math.acos((d * d + 1 - e * e) / (2 * d)) + e * e * Math.acos((d * d + e * e - 1) / (2 * d * e)) - 0.5 * Math.sqrt((-d + 1 + e) * (d + 1 - e) * (d - 1 + e) * (d + 1 + e));
  return 1 - a / Math.PI;
}

/** Light left at a point `rho` from the shadow axis, 0..1: direct sun, and the umbra's red refracted glow. */
export function shadowLight(rho: number, ru: number, rp: number): { sun: number; glow: number } {
  const e = (rp + ru) / (rp - ru);
  const sun = sunVisible(e, e - 1 + (2 * (rho - ru)) / (rp - ru));
  const x = Math.min(rho / ru, 1);
  return { sun, glow: UMBRA_AXIS_LIGHT * Math.exp(UMBRA_RISE * x * x) * (1 - sun) };
}

/** Fraction of a disc of radius `a` inside a circle of radius `b`, centres `d` apart. */
function discInside(a: number, b: number, d: number): number {
  if (d >= a + b) return 0;
  if (d <= b - a) return 1;
  if (d <= a - b) return (b * b) / (a * a);
  const lens = a * a * Math.acos((d * d + a * a - b * b) / (2 * d * a)) + b * b * Math.acos((d * d + b * b - a * a) / (2 * d * b)) - 0.5 * Math.sqrt((-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b));
  return lens / (Math.PI * a * a);
}

/** Fractions of the moon's disc inside Earth's penumbra (umbra included) and umbra, geocentric. */
export function lunarShadowCoverage(date: Date): { penumbra: number; umbra: number } {
  const { g, rp, ru, sM } = earthShadow(new AstroTime(date));
  return { penumbra: discInside(sM, rp, g), umbra: discInside(sM, ru, g) };
}

const DISC_SAMPLES = 24;

/** Moonlight left by a lunar eclipse, averaged over the disc: 1 outside the penumbra. */
export function lunarEclipseLight(date: Date): number {
  const { g, rp, ru, sM } = earthShadow(new AstroTime(date));
  if (g >= rp + sM) return 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < DISC_SAMPLES; i++) {
    for (let j = 0; j < DISC_SAMPLES; j++) {
      const x = ((i + 0.5) / DISC_SAMPLES) * 2 - 1;
      const y = ((j + 0.5) / DISC_SAMPLES) * 2 - 1;
      if (x * x + y * y > 1) continue;
      const l = shadowLight(Math.hypot(g + x * sM, y * sM), ru, rp);
      sum += l.sun + l.glow;
      n++;
    }
  }
  return sum / n;
}

/** Earth's shadow on the sky as the observer sees it, EQJ; null when the moon is clear of the penumbra. */
export interface ShadowView {
  /** Unit direction of the shadow axis where it crosses the moon's distance, and of the moon itself. */
  axis: V3;
  moon: V3;
  /** Umbral and penumbral radii there, radians. */
  umbra: number;
  penumbra: number;
}

export function shadowView(date: Date, obs: Observer): ShadowView | null {
  const t = new AstroTime(date);
  const { s, m } = sunMoon(t);
  const sh = earthShadowAt(s, m);
  if (sh.g >= sh.rp + sh.sM) return null;
  const o = ObserverVector(t, obs, false);
  const dm = Math.hypot(...m);
  const ds = Math.hypot(...s);
  const c: V3 = [(-s[0] / ds) * dm - o.x, (-s[1] / ds) * dm - o.y, (-s[2] / ds) * dm - o.z];
  const dc = Math.hypot(...c);
  const mo: V3 = [m[0] - o.x, m[1] - o.y, m[2] - o.z];
  const dmo = Math.hypot(...mo);
  const k = dm / dc;
  return { axis: [c[0] / dc, c[1] / dc, c[2] / dc], moon: [mo[0] / dmo, mo[1] / dmo, mo[2] / dmo], umbra: sh.ru * k, penumbra: sh.rp * k };
}
