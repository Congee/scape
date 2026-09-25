/** The 120 constituents NOAA CO-OPS publishes, in its order; bundled station data indexes into this list. */
export const CONSTITUENT_NAMES = [
  'M2', 'S2', 'N2', 'K1', 'M4', 'O1', 'M6', 'MK3', 'S4', 'MN4', 'NU2', 'S6', 'MU2', '2N2', 'OO1', 'LAM2', 'S1', 'M1', 'J1',
  'MM', 'SSA', 'SA', 'MSF', 'MF', 'RHO', 'Q1', 'T2', 'R2', '2Q1', 'P1', '2SM2', 'M3', 'L2', '2MK3', 'K2', 'M8', 'MS4',
  // Most stations publish only the 37 above; shallow-water ports such as Anchorage add these.
  'SIGMA1', 'MP1', 'CHI1', '2PO1', 'SO1', 'MSN2', 'MNS2', 'OP2', 'MKS2', '2NS2', 'MLN2S2', '2ML2S2', 'SKM2', '2MS2K2', 'MKL2S2',
  'M2KS2', '2SNMK2', '2KMSN2', 'SO3', 'SK3', 'NO3', 'MK4', 'SN4', '2MLS4', '3MS4', 'ML4', 'N4', 'SL4', 'MNO5', '2MO5', '2MK5',
  'MSK5', '3KM5', '2MP5', '3MP5', 'MNK5', '2SM6', '2MN6', 'MSN6', '2MS6', '2NMLS6', '2NM6', 'MSL6', '2ML6', 'MSK6', '2MLNS6',
  '3MLS6', '2MK6', '2MNO7', '2NMK7', '2MSO7', 'MSKO7', '2MSN8', '3MS8', '2MS8', '2MN8', '3MN8', '2MSL8', '4MLS8', '3ML8', '3MK8',
  '2MSK8', '2M2NK9', '3MNK9', '4MK9', '3MSK9', '4MN10', 'M10', '3MNS10', '4MS10', '3MSL10', '3M2S10', '4MSK11', '4MNS12',
  '5MS12', '4MSL12', '4M2S12', 'TK1', 'RP1', 'KP1', 'THETA1', 'KJ2', 'OO2'
] as const;

type Name = (typeof CONSTITUENT_NAMES)[number];

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
const J1: Nodal = (a) => [Math.sin(2 * a.I) / 0.7214, -a.nu];
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

const BASE = {
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
  J1: { v: [1, 1, 1, -1, 0, -90], nodal: J1 },
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
  MS4: { v: [4, -2, 2, 0, 0, 0], nodal: M2 },
  CHI1: { v: [1, -1, 3, -1, 0, -90], nodal: J1 },
  THETA1: { v: [1, 1, -1, 1, 0, -90], nodal: J1 }
} satisfies Partial<Record<Name, Constituent>>;

type Base = keyof typeof BASE;

/** A shallow-water compound Σ kᵢ·Cᵢ: arguments add, node factors multiply, as NOAA builds them. */
function compound(parts: Partial<Record<Base, number>>): Constituent {
  const terms = Object.entries(parts) as [Base, number][];
  const v = [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number];
  for (const [n, k] of terms) for (let i = 0; i < 6; i++) v[i] += k * BASE[n].v[i];
  const nodal: Nodal = (a) => {
    let f = 1;
    let u = 0;
    for (const [n, k] of terms) {
      const [fi, ui] = BASE[n].nodal(a);
      f *= fi ** Math.abs(k);
      u += k * ui;
    }
    return [f, u];
  };
  return { v, nodal };
}

export const CONSTITUENTS: Record<Name, Constituent> = {
  ...BASE,
  MP1: compound({ M2: 1, P1: -1 }),
  '2PO1': compound({ P1: 2, O1: -1 }),
  SO1: compound({ S2: 1, O1: -1 }),
  MSN2: compound({ M2: 1, S2: 1, N2: -1 }),
  MNS2: compound({ M2: 1, N2: 1, S2: -1 }),
  OP2: compound({ O1: 1, P1: 1 }),
  MKS2: compound({ M2: 1, K2: 1, S2: -1 }),
  '2NS2': compound({ N2: 2, S2: -1 }),
  MLN2S2: compound({ M2: 1, L2: 1, N2: 1, S2: -2 }),
  '2ML2S2': compound({ M2: 2, L2: 1, S2: -2 }),
  SKM2: compound({ S2: 1, K2: 1, M2: -1 }),
  '2MS2K2': compound({ M2: 2, S2: 1, K2: -2 }),
  MKL2S2: compound({ M2: 1, K2: 1, L2: 1, S2: -2 }),
  M2KS2: compound({ M2: 1, K2: 2, S2: -2 }),
  '2SNMK2': compound({ S2: 2, N2: 1, M2: -1, K2: -1 }),
  '2KMSN2': compound({ K2: 2, M2: 1, S2: -1, N2: -1 }),
  SO3: compound({ S2: 1, O1: 1 }),
  SK3: compound({ S2: 1, K1: 1 }),
  NO3: compound({ N2: 1, O1: 1 }),
  MK4: compound({ M2: 1, K2: 1 }),
  SN4: compound({ S2: 1, N2: 1 }),
  '2MLS4': compound({ M2: 2, L2: 1, S2: -1 }),
  '3MS4': compound({ M2: 3, S2: -1 }),
  ML4: compound({ M2: 1, L2: 1 }),
  N4: compound({ N2: 2 }),
  SL4: compound({ S2: 1, L2: 1 }),
  MNO5: compound({ M2: 1, N2: 1, O1: 1 }),
  '2MO5': compound({ M2: 2, O1: 1 }),
  '2MK5': compound({ M2: 2, K1: 1 }),
  MSK5: compound({ M2: 1, S2: 1, K1: 1 }),
  '3KM5': compound({ K2: 1, K1: 1, M2: 1 }),
  '2MP5': compound({ M2: 2, P1: 1 }),
  '3MP5': compound({ M2: 3, P1: -1 }),
  MNK5: compound({ M2: 1, N2: 1, K1: 1 }),
  '2SM6': compound({ S2: 2, M2: 1 }),
  '2MN6': compound({ M2: 2, N2: 1 }),
  MSN6: compound({ M2: 1, S2: 1, N2: 1 }),
  '2MS6': compound({ M2: 2, S2: 1 }),
  '2NMLS6': compound({ N2: 2, M2: 1, L2: 1, S2: -1 }),
  '2NM6': compound({ N2: 2, M2: 1 }),
  MSL6: compound({ M2: 1, S2: 1, L2: 1 }),
  '2ML6': compound({ M2: 2, L2: 1 }),
  MSK6: compound({ M2: 1, S2: 1, K2: 1 }),
  '2MLNS6': compound({ M2: 2, L2: 1, N2: 1, S2: -1 }),
  '3MLS6': compound({ M2: 3, L2: 1, S2: -1 }),
  '2MK6': compound({ M2: 2, K2: 1 }),
  '2MNO7': compound({ M2: 2, N2: 1, O1: 1 }),
  '2NMK7': compound({ N2: 2, M2: 1, K1: 1 }),
  '2MSO7': compound({ M2: 2, S2: 1, O1: 1 }),
  MSKO7: compound({ M2: 1, S2: 1, K2: 1, O1: 1 }),
  '2MSN8': compound({ M2: 2, S2: 1, N2: 1 }),
  '3MS8': compound({ M2: 3, S2: 1 }),
  '2MS8': compound({ M2: 2, S2: 2 }),
  '2MN8': compound({ M2: 2, N2: 2 }),
  '3MN8': compound({ M2: 3, N2: 1 }),
  '2MSL8': compound({ M2: 2, S2: 1, L2: 1 }),
  '4MLS8': compound({ M2: 4, L2: 1, S2: -1 }),
  '3ML8': compound({ M2: 3, L2: 1 }),
  '3MK8': compound({ M2: 3, K2: 1 }),
  '2MSK8': compound({ M2: 2, S2: 1, K2: 1 }),
  '2M2NK9': compound({ M2: 2, N2: 2, K1: 1 }),
  '3MNK9': compound({ M2: 3, N2: 1, K1: 1 }),
  '4MK9': compound({ M2: 4, K1: 1 }),
  '3MSK9': compound({ M2: 3, S2: 1, K1: 1 }),
  '4MN10': compound({ M2: 4, N2: 1 }),
  M10: compound({ M2: 5 }),
  '3MNS10': compound({ M2: 3, N2: 1, S2: 1 }),
  '4MS10': compound({ M2: 4, S2: 1 }),
  '3MSL10': compound({ M2: 3, S2: 1, L2: 1 }),
  '3M2S10': compound({ M2: 3, S2: 2 }),
  '4MSK11': compound({ M2: 4, S2: 1, K1: 1 }),
  '4MNS12': compound({ M2: 4, N2: 1, S2: 1 }),
  '5MS12': compound({ M2: 5, S2: 1 }),
  '4MSL12': compound({ M2: 4, S2: 1, L2: 1 }),
  '4M2S12': compound({ M2: 4, S2: 2 }),
  SIGMA1: compound({ O1: 2, P1: -1 }),
  TK1: { v: [1, 0, -2, 0, 1, 90], nodal: ONE },
  RP1: { v: [1, 0, 2, 0, -1, -90], nodal: ONE },
  KP1: { v: [1, 0, 3, 0, 0, -90], nodal: ONE },
  KJ2: compound({ K1: 1, J1: 1 }),
  OO2: compound({ O1: 1, Q1: 1 })
};
