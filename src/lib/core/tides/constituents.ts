/** The 37 constituents NOAA CO-OPS publishes, in its order; bundled station data indexes into this list. */
export const CONSTITUENT_NAMES = [
  'M2', 'S2', 'N2', 'K1', 'M4', 'O1', 'M6', 'MK3', 'S4', 'MN4', 'NU2', 'S6', 'MU2', '2N2', 'OO1', 'LAM2', 'S1', 'M1', 'J1',
  'MM', 'SSA', 'SA', 'MSF', 'MF', 'RHO', 'Q1', 'T2', 'R2', '2Q1', 'P1', '2SM2', 'M3', 'L2', '2MK3', 'K2', 'M8', 'MS4'
] as const;

/** Schureman's slowly varying lunar-node quantities, degrees except `I`-derived ratios. */
export interface NodeArgs {
  /** Inclination of the moon's orbit to the equator, radians. */
  I: number;
  xi: number;
  nu: number;
  /** ν′ and 2ν″ of K1 and K2. */
  nuP: number;
  nu2PP: number;
  /** Mean longitude of the lunar perigee from the intersection, degrees. */
  P: number;
}

const D = Math.PI / 180;

/** Nodal factor f and phase u (degrees), per Schureman (1958) as used for NOAA predictions. */
type Nodal = (a: NodeArgs) => [f: number, u: number];

const fM2 = (a: NodeArgs) => Math.cos(a.I / 2) ** 4 / 0.9154;
const fO1 = (a: NodeArgs) => (Math.sin(a.I) * Math.cos(a.I / 2) ** 2) / 0.38;
const fK1 = (a: NodeArgs) => {
  const s2 = Math.sin(2 * a.I);
  return Math.sqrt(0.8965 * s2 * s2 + 0.6001 * s2 * Math.cos(a.nu * D) + 0.1006);
};
const uM2 = (a: NodeArgs) => 2 * a.xi - 2 * a.nu;
const uO1 = (a: NodeArgs) => 2 * a.xi - a.nu;

const ONE: Nodal = () => [1, 0];
const M2: Nodal = (a) => [fM2(a), uM2(a)];
const O1: Nodal = (a) => [fO1(a), uO1(a)];
const K1: Nodal = (a) => [fK1(a), -a.nuP];
const pow = (n: number): Nodal => (a) => [fM2(a) ** n, n * uM2(a)];

const L2: Nodal = (a) => {
  const t2 = Math.tan(a.I / 2) ** 2;
  const c2p = Math.cos(2 * a.P * D);
  const R = Math.atan(Math.sin(2 * a.P * D) / (1 / (6 * t2) - c2p)) / D;
  return [fM2(a) * Math.sqrt(1 - 12 * t2 * c2p + 36 * t2 * t2), uM2(a) - R];
};
// NOAA's M1 (at NO1 speed): f as in pytides, phase fitted to CO-OPS predictions 2019–2026.
const M1: Nodal = (a) => {
  const Q = Math.atan2(0.483 * Math.sin(a.P * D), Math.cos(a.P * D)) / D;
  return [fO1(a) * Math.sqrt(2.31 + 1.435 * Math.cos(2 * a.P * D)), Q - a.P - a.nu + 20];
};
const K2: Nodal = (a) => {
  const si = Math.sin(a.I);
  return [Math.sqrt(19.0444 * si ** 4 + 2.7702 * si * si * Math.cos(2 * a.nu * D) + 0.0981), -a.nu2PP];
};

export interface Constituent {
  /** Coefficients of T, s, h, p, p1, then a constant in degrees; V = Σ cᵢ·argᵢ. */
  v: readonly [number, number, number, number, number, number];
  nodal: Nodal;
}

export const CONSTITUENTS: Record<(typeof CONSTITUENT_NAMES)[number], Constituent> = {
  M2: { v: [2, -2, 2, 0, 0, 0], nodal: M2 },
  S2: { v: [2, 0, 0, 0, 0, 0], nodal: ONE },
  N2: { v: [2, -3, 2, 1, 0, 0], nodal: M2 },
  K1: { v: [1, 0, 1, 0, 0, -90], nodal: K1 },
  M4: { v: [4, -4, 4, 0, 0, 0], nodal: pow(2) },
  O1: { v: [1, -2, 1, 0, 0, 90], nodal: O1 },
  M6: { v: [6, -6, 6, 0, 0, 0], nodal: pow(3) },
  MK3: { v: [3, -2, 3, 0, 0, -90], nodal: (a) => [fM2(a) * fK1(a), uM2(a) - a.nuP] },
  S4: { v: [4, 0, 0, 0, 0, 0], nodal: ONE },
  MN4: { v: [4, -5, 4, 1, 0, 0], nodal: pow(2) },
  NU2: { v: [2, -3, 4, -1, 0, 0], nodal: M2 },
  S6: { v: [6, 0, 0, 0, 0, 0], nodal: ONE },
  MU2: { v: [2, -4, 4, 0, 0, 0], nodal: M2 },
  '2N2': { v: [2, -4, 2, 2, 0, 0], nodal: M2 },
  OO1: { v: [1, 2, 1, 0, 0, -90], nodal: (a) => [(Math.sin(a.I) * Math.sin(a.I / 2) ** 2) / 0.0164, -2 * a.xi - a.nu] },
  LAM2: { v: [2, -1, 0, 1, 0, 180], nodal: M2 },
  S1: { v: [1, 0, 0, 0, 0, 0], nodal: ONE },
  M1: { v: [1, -1, 1, 1, 0, -90], nodal: M1 },
  J1: { v: [1, 1, 1, -1, 0, -90], nodal: (a) => [Math.sin(2 * a.I) / 0.7214, -a.nu] },
  MM: { v: [0, 1, 0, -1, 0, 0], nodal: (a) => [(2 / 3 - Math.sin(a.I) ** 2) / 0.5021, 0] },
  SSA: { v: [0, 0, 2, 0, 0, 0], nodal: ONE },
  SA: { v: [0, 0, 1, 0, 0, 0], nodal: ONE },
  MSF: { v: [0, 2, -2, 0, 0, 0], nodal: (a) => [fM2(a), -uM2(a)] },
  MF: { v: [0, 2, 0, 0, 0, 0], nodal: (a) => [Math.sin(a.I) ** 2 / 0.1578, -2 * a.xi] },
  RHO: { v: [1, -3, 3, -1, 0, 90], nodal: O1 },
  Q1: { v: [1, -3, 1, 1, 0, 90], nodal: O1 },
  T2: { v: [2, 0, -1, 0, 1, 0], nodal: ONE },
  R2: { v: [2, 0, 1, 0, -1, 180], nodal: ONE },
  '2Q1': { v: [1, -4, 1, 2, 0, 90], nodal: O1 },
  P1: { v: [1, 0, -1, 0, 0, 90], nodal: ONE },
  '2SM2': { v: [2, 2, -2, 0, 0, 0], nodal: (a) => [fM2(a), -uM2(a)] },
  M3: { v: [3, -3, 3, 0, 0, 0], nodal: (a) => [fM2(a) ** 1.5, 1.5 * uM2(a)] },
  L2: { v: [2, -1, 2, -1, 0, 180], nodal: L2 },
  '2MK3': { v: [3, -4, 3, 0, 0, 90], nodal: (a) => [fM2(a) ** 2 * fK1(a), 2 * uM2(a) + a.nuP] },
  K2: { v: [2, 0, 2, 0, 0, 0], nodal: K2 },
  M8: { v: [8, -8, 8, 0, 0, 0], nodal: pow(4) },
  MS4: { v: [4, -2, 2, 0, 0, 0], nodal: M2 }
};
