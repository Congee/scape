import { Body, GeoMoon, GeoVector, Illumination, MakeTime, ObserverVector, RotateVector, Rotation_EQJ_EQD, Rotation_EQJ_HOR, RotationAxis, type Observer, type Vector } from 'astronomy-engine';

type V3 = [number, number, number];

/** What the moon looks like from one place at one instant. */
export interface MoonView {
  /** Illuminated fraction 0..1 and the sun–moon–observer angle, degrees. */
  illumination: number;
  phaseAngleDeg: number;
  waxing: boolean;
  /** Selenographic longitude and latitude of the point facing the observer, degrees; east positive. */
  librationLonDeg: number;
  librationLatDeg: number;
  /** Selenographic point under the sun, degrees. */
  subSolarLonDeg: number;
  subSolarLatDeg: number;
  /** Position angles from celestial north (of date) through east, degrees: the lunar north pole and the bright limb's midpoint. */
  axisPaDeg: number;
  brightLimbPaDeg: number;
  /** Position angle of the zenith; subtract from a position angle to measure it from "up" in a level frame. */
  parallacticDeg: number;
  semidiameterDeg: number;
  distanceKm: number;
  /** A thin phase leaves the Earth nearly full in the moon's sky, so the dark side glows. */
  earthshine: boolean;
  /** Rows map ENU (east, north, up) vectors to the moon's body frame: x at 0° lon, z the north pole. */
  enuToBody: Float64Array;
  /** Unit vector from the moon towards the sun, ENU. */
  sunFromMoonEnu: V3;
}

const D2R = Math.PI / 180;
const KM_PER_AU = 149_597_870.7;
const MOON_RADIUS_KM = 1737.4;
/** Below this lit fraction the earthshine is plain to the eye. */
const EARTHSHINE_MAX_ILLUM = 0.35;

const sub = (a: Vector, b: Vector): V3 => [a.x - b.x, a.y - b.y, a.z - b.z];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const wrap360 = (d: number) => ((d % 360) + 360) % 360;
const wrap180 = (d: number) => wrap360(d + 180) - 180;

const r1 = (t: number): [V3, V3, V3] => [
  [1, 0, 0],
  [0, Math.cos(t), Math.sin(t)],
  [0, -Math.sin(t), Math.cos(t)]
];
const r3 = (t: number): [V3, V3, V3] => [
  [Math.cos(t), Math.sin(t), 0],
  [-Math.sin(t), Math.cos(t), 0],
  [0, 0, 1]
];
const mul = (m: [V3, V3, V3], n: [V3, V3, V3]): [V3, V3, V3] =>
  m.map((row) => [0, 1, 2].map((j) => row[0] * n[0][j] + row[1] * n[1][j] + row[2] * n[2][j]) as V3) as [V3, V3, V3];

/** Rows of the IAU body-fixed rotation Rz(W)·Rx(90° − δ0)·Rz(90° + α0) from J2000. */
function bodyRows(raDeg: number, decDeg: number, wDeg: number): [V3, V3, V3] {
  const a = (90 + raDeg) * D2R;
  const b = (90 - decDeg) * D2R;
  const w = wDeg * D2R;
  return mul(r3(w), mul(r1(b), r3(a)));
}

const apply = (m: [V3, V3, V3], v: V3): V3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/** Position angle of direction `v` on the sky around direction `d`, both in the same equatorial frame. */
export function positionAngleDeg(d: V3, v: V3): number {
  const n = norm([-d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2]]);
  const e = norm([-d[1], d[0], 0]);
  return wrap360(Math.atan2(dot(v, e), dot(v, n)) / D2R);
}

const lonLat = (v: V3): [number, number] => {
  const u = norm(v);
  return [wrap180(Math.atan2(u[1], u[0]) / D2R), Math.asin(u[2]) / D2R];
};

export function moonView(date: Date, obs: Observer): MoonView {
  const t = MakeTime(date);
  // Moon light-time is 1.3 s; the rotation over it is far below the tolerance.
  const moonGeo = GeoMoon(t);
  const moonTopo = sub(moonGeo, ObserverVector(t, obs, false));
  const sunGeo = GeoVector(Body.Sun, t, true);
  const sunTopo = sub(sunGeo, ObserverVector(t, obs, false));
  const sunFromMoon = sub(sunGeo, moonGeo);

  const axis = RotationAxis(Body.Moon, t);
  const rows = bodyRows(axis.ra * 15, axis.dec, axis.spin);
  const toObs: V3 = [-moonTopo[0], -moonTopo[1], -moonTopo[2]];
  const [librationLonDeg, librationLatDeg] = lonLat(apply(rows, toObs));
  const [subSolarLonDeg, subSolarLatDeg] = lonLat(apply(rows, sunFromMoon));

  const eqd = Rotation_EQJ_EQD(t);
  const toEqd = (v: V3): V3 => {
    const r = RotateVector(eqd, { x: v[0], y: v[1], z: v[2], t } as Vector);
    return [r.x, r.y, r.z];
  };
  const d = norm(toEqd(moonTopo));
  const pole = toEqd([axis.north.x, axis.north.y, axis.north.z]);
  const sunDir = norm(toEqd(sunTopo));

  // HOR is x north, y west, z zenith; its third row is the zenith in J2000.
  const hor = Rotation_EQJ_HOR(t, obs).rot;
  const zenith = toEqd([hor[0][2], hor[1][2], hor[2][2]]);
  const enuFromEqj: [V3, V3, V3] = [
    [-hor[0][1], -hor[1][1], -hor[2][1]],
    [hor[0][0], hor[1][0], hor[2][0]],
    [hor[0][2], hor[1][2], hor[2][2]]
  ];
  // Body = rows · EQJ and EQJ = enuFromEqjᵀ · ENU.
  const enuToBody = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) enuToBody[i * 3 + j] = rows[i][0] * enuFromEqj[j][0] + rows[i][1] * enuFromEqj[j][1] + rows[i][2] * enuFromEqj[j][2];

  const illum = Illumination(Body.Moon, t);
  const distKm = Math.hypot(...moonTopo) * KM_PER_AU;
  const s = norm(sunFromMoon);
  const illumination = illum.phase_fraction;
  return {
    illumination,
    phaseAngleDeg: illum.phase_angle,
    waxing: isWaxing(moonGeo, sunGeo),
    librationLonDeg,
    librationLatDeg,
    subSolarLonDeg,
    subSolarLatDeg,
    axisPaDeg: positionAngleDeg(d, pole),
    brightLimbPaDeg: positionAngleDeg(d, sunDir),
    parallacticDeg: positionAngleDeg(d, zenith),
    semidiameterDeg: Math.asin(MOON_RADIUS_KM / distKm) / D2R,
    distanceKm: distKm,
    earthshine: illumination < EARTHSHINE_MAX_ILLUM,
    enuToBody,
    sunFromMoonEnu: apply(enuFromEqj, s)
  };
}

/** Waxing while the moon runs ahead of the sun in ecliptic longitude, i.e. east of it. */
function isWaxing(moon: Vector, sun: Vector): boolean {
  // Ecliptic north in J2000 equatorial coordinates.
  const ecl: V3 = [0, -Math.sin(23.4392911 * D2R), Math.cos(23.4392911 * D2R)];
  const m: V3 = [moon.x, moon.y, moon.z];
  const s: V3 = [sun.x, sun.y, sun.z];
  const cross: V3 = [s[1] * m[2] - s[2] * m[1], s[2] * m[0] - s[0] * m[2], s[0] * m[1] - s[1] * m[0]];
  return dot(cross, ecl) > 0;
}
