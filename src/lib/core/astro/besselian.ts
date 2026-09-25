import { AstroTime, type Observer } from 'astronomy-engine';

/** Polynomial Besselian elements of one solar eclipse, in TDT hours from t0 (NASA Five Millennium Canon). */
export interface BesselianElements {
  /** TT days since J2000 at t0. */
  t0Tt: number;
  x: number[];
  y: number[];
  /** Declination of the shadow axis and its ephemeris hour angle, degrees. */
  d: number[];
  mu: number[];
  /** Penumbral and umbral radii on the fundamental plane, Earth radii; l2 < 0 is total. */
  l1: number[];
  l2: number[];
  tanF1: number;
  tanF2: number;
}

/** public/eclipses/besselian.json. */
export interface BesselianFile {
  k1: number;
  k2: number;
  elements: number[][];
}

const J2000_JD = 2451545;

/** Unpacks the bundled rows: [t0's TDT midnight JD, t0 h, NASA's ΔT, x0–3, y0–3, d0–2, μ0–2, l1 0–2, l2 0–2, tan f1, tan f2]. */
export function parseBesselian(file: BesselianFile): BesselianElements[] {
  return file.elements.map((r) => ({
    t0Tt: r[0] - J2000_JD + r[1] / 24,
    x: r.slice(3, 7),
    y: r.slice(7, 11),
    d: r.slice(11, 14),
    mu: r.slice(14, 17),
    l1: r.slice(17, 20),
    l2: r.slice(20, 23),
    tanF1: r[23],
    tanF2: r[24]
  }));
}

const poly = (c: number[], t: number) => c.reduceRight((acc, k) => acc * t + k, 0);
const dpoly = (c: number[], t: number) => c.reduceRight((acc, k, i) => (i === 0 ? acc : acc * t + i * k), 0);

const DEG = Math.PI / 180;
const EARTH_EQ_M = 6_378_137;
const B_OVER_A = 1 - 1 / 298.257223563;
// Earth's rotation in degrees per second of ΔT.
const ROT_DEG_PER_S = (15 * 1.002_737_909) / 3600;

/** Observer and shadow on the fundamental plane at one instant, Earth radii and radii per hour. */
export interface PlaneState {
  u: number;
  v: number;
  a: number;
  b: number;
  L1: number;
  L2: number;
}

export interface BesselianSite {
  rhoSin: number;
  rhoCos: number;
  lngDeg: number;
}

export function besselianSite(obs: Observer): BesselianSite {
  const phi = obs.latitude * DEG;
  const u = Math.atan(B_OVER_A * Math.tan(phi));
  const h = obs.height / EARTH_EQ_M;
  return { rhoSin: B_OVER_A * Math.sin(u) + h * Math.sin(phi), rhoCos: Math.cos(u) + h * Math.cos(phi), lngDeg: obs.longitude };
}

/** Explanatory Supplement / Meeus: the observer's place against the shadow, `t` TDT hours from t0. */
export function planeState(e: BesselianElements, site: BesselianSite, t: number, deltaTs: number): PlaneState {
  const x = poly(e.x, t);
  const y = poly(e.y, t);
  const d = poly(e.d, t) * DEG;
  const dd = dpoly(e.d, t) * DEG;
  const muDot = dpoly(e.mu, t) * DEG;
  const H = (poly(e.mu, t) + site.lngDeg - ROT_DEG_PER_S * deltaTs) * DEG;
  const xi = site.rhoCos * Math.sin(H);
  const eta = site.rhoSin * Math.cos(d) - site.rhoCos * Math.cos(H) * Math.sin(d);
  const zeta = site.rhoSin * Math.sin(d) + site.rhoCos * Math.cos(H) * Math.cos(d);
  const xiDot = muDot * site.rhoCos * Math.cos(H);
  const etaDot = muDot * xi * Math.sin(d) - zeta * dd;
  return {
    u: x - xi,
    v: y - eta,
    a: dpoly(e.x, t) - xiDot,
    b: dpoly(e.y, t) - etaDot,
    L1: poly(e.l1, t) - zeta * e.tanF1,
    L2: poly(e.l2, t) - zeta * e.tanF2
  };
}

const MAX_ITER = 30;
const TOL_H = 1e-9;

function iterate(step: (t: number) => number, t: number): number | null {
  for (let i = 0; i < MAX_ITER; i++) {
    const dt = step(t);
    if (!Number.isFinite(dt)) return null;
    t += dt;
    if (Math.abs(dt) < TOL_H) return t;
  }
  return null;
}

export interface BesselianLocal {
  /** TDT hours from t0. */
  max: number;
  c1: number;
  c4: number;
  /** Present when the observer is inside the umbra or antumbra at maximum. */
  c2: number | null;
  c3: number | null;
  /** At maximum: distance from the axis and the two shadow radii (umbral negative when total). */
  m: number;
  L1: number;
  L2: number;
}

/** Local circumstances from the elements, geometric (no refraction); null when the penumbra misses the site. */
export function besselianLocal(e: BesselianElements, obs: Observer, deltaTs: number): BesselianLocal | null {
  const site = besselianSite(obs);
  const at = (t: number) => planeState(e, site, t, deltaTs);
  const max = iterate((t) => {
    const s = at(t);
    return -(s.u * s.a + s.v * s.b) / (s.a * s.a + s.b * s.b);
  }, 0);
  if (max === null) return null;
  const s = at(max);
  const m = Math.hypot(s.u, s.v);
  if (m >= s.L1) return null;
  const contact = (radius: (p: PlaneState) => number, sign: -1 | 1) =>
    iterate((t) => {
      const p = at(t);
      const n = Math.hypot(p.a, p.b);
      const L = radius(p);
      const S = (p.a * p.v - p.u * p.b) / (n * L);
      return -(p.u * p.a + p.v * p.b) / (n * n) + (sign * L * Math.sqrt(1 - S * S)) / n;
    }, max);
  const c1 = contact((p) => p.L1, -1);
  const c4 = contact((p) => p.L1, 1);
  if (c1 === null || c4 === null) return null;
  const central = m < Math.abs(s.L2);
  const c2 = central ? contact((p) => Math.abs(p.L2), -1) : null;
  const c3 = central ? contact((p) => Math.abs(p.L2), 1) : null;
  if (central && (c2 === null || c3 === null)) return null;
  return { max, c1, c4, c2, c3, m, L1: s.L1, L2: s.L2 };
}

/** The elements' TDT hours from t0 as an instant. */
export const besselianTime = (e: BesselianElements, t: number) => AstroTime.FromTerrestrialTime(e.t0Tt + t / 24);

/** TDT hours from t0 at a UT instant. */
export const besselianHours = (e: BesselianElements, time: AstroTime) => (time.tt - e.t0Tt) * 24;
