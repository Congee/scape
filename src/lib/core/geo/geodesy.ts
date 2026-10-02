/*
 * Ported from GeographicLib (https://github.com/geographiclib/geographiclib-js), MIT License:
 *
 * Copyright (c) 2011-2022, Charles Karney
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
 * OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * WGS84 geodesy: Karney's geodesic inverse and direct (after GeographicLib), exact to ~15 nm and
 * 1e-12° on the ellipsoid. Vertical geometry stays spherical with refraction; see `curvatureDropM`.
 */

export const EARTH_RADIUS_M = 6371008.8;
export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Decimal digits each axis is known to. */
export interface Digits {
  lat: number;
  lng: number;
}

export interface LngLat {
  lng: number;
  lat: number;
  /** Absent when unknown: computed points and data saved before precision was kept. */
  digits?: Digits;
}

export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

const F1 = 1 - WGS84_F;
const E2 = WGS84_F * (2 - WGS84_F);
const EP2 = E2 / (F1 * F1);
const N3 = WGS84_F / (2 - WGS84_F);
const B = WGS84_A * F1;
const ORDER = 6;
const TINY = Math.sqrt(Number.MIN_VALUE);
const TOL0 = Number.EPSILON;
const TOL1 = 200 * TOL0;
const TOL2 = Math.sqrt(TOL0);
const TOLB = TOL0;
const XTHRESH = 1000 * TOL2;
const MAXIT1 = 20;
const MAXIT2 = MAXIT1 + 53 + 10;
const ETOL2 = (0.1 * TOL2) / Math.sqrt((Math.max(0.001, Math.abs(WGS84_F)) * Math.min(1, 1 - WGS84_F / 2)) / 2);

const sq = (x: number) => x * x;
const copysign = (x: number, y: number) => (y < 0 || Object.is(y, -0) ? -Math.abs(x) : Math.abs(x));

function polyval(n: number, p: readonly number[], s: number, x: number): number {
  let y = n < 0 ? 0 : p[s];
  while (n-- > 0) y = y * x + p[++s];
  return y;
}

function norm(x: number, y: number): [number, number] {
  const r = Math.hypot(x, y);
  return [x / r, y / r];
}

/** Error-free sum: [s, t] with s + t = u + v exactly. */
function sum(u: number, v: number): [number, number] {
  const s = u + v;
  let up = s - v;
  let vpp = s - up;
  up -= u;
  vpp -= v;
  return [s, s === 0 ? s : 0 - (up + vpp)];
}

function remainder(x: number, y: number): number {
  x %= y;
  return x < -y / 2 ? x + y : x < y / 2 ? x : x - y;
}

function angNormalize(x: number): number {
  const y = remainder(x, 360);
  return Math.abs(y) === 180 ? copysign(180, x) : y;
}

function angRound(x: number): number {
  const z = 1 / 16;
  let y = Math.abs(x);
  if (y < z) y = z - (z - y);
  return x < 0 ? -y : y;
}

function latFix(x: number): number {
  return Math.abs(x) > 90 ? NaN : x;
}

function angDiff(x: number, y: number): [number, number] {
  let [d, t] = sum(remainder(-x, 360), remainder(y, 360));
  [d, t] = sum(remainder(d, 360), t);
  if (d === 0 || Math.abs(d) === 180) d = copysign(d, t === 0 ? y - x : -t);
  return [d, t];
}

function quadrant(s: number, c: number, q: number, x: number): [number, number] {
  q = ((q % 4) + 4) % 4;
  if (q === 1) [s, c] = [c, -s];
  else if (q === 2) [s, c] = [-s, -c];
  else if (q === 3) [s, c] = [-c, s];
  c += 0;
  if (s === 0) s = copysign(0, x);
  return [s, c];
}

function sincosd(x: number): [number, number] {
  let r = x % 360;
  const q = Number.isNaN(r) ? 0 : Math.round(r / 90);
  r = (r - 90 * q) * D2R;
  return quadrant(Math.sin(r), Math.cos(r), q, x);
}

/** sin and cos of (x + t) degrees, x in [-180, 180], keeping t's small correction. */
function sincosde(x: number, t: number): [number, number] {
  const q = Math.round(x / 90);
  const r = angRound(x - 90 * q + t) * D2R;
  return quadrant(Math.sin(r), Math.cos(r), q, x);
}

function atan2d(y: number, x: number): number {
  let q = 0;
  if (Math.abs(y) > Math.abs(x)) {
    [x, y] = [y, x];
    q = 2;
  }
  if (x < 0) {
    q++;
    x = -x;
  }
  let ang = Math.atan2(y, x) * R2D;
  if (q === 1) ang = copysign(180, y) - ang;
  else if (q === 2) ang = 90 - ang;
  else if (q === 3) ang = -90 + ang;
  return ang;
}

function sinCosSeries(sinp: boolean, sinx: number, cosx: number, c: ArrayLike<number>): number {
  let k = c.length;
  let n = k - (sinp ? 1 : 0);
  const ar = 2 * (cosx - sinx) * (cosx + sinx);
  let y0 = n & 1 ? c[--k] : 0;
  let y1 = 0;
  n >>= 1;
  while (n--) {
    y1 = ar * y0 - y1 + c[--k];
    y0 = ar * y1 - y0 + c[--k];
  }
  return sinp ? 2 * sinx * cosx * y0 : cosx * (y0 - y1);
}

function astroid(x: number, y: number): number {
  const p = sq(x);
  const q = sq(y);
  const r = (p + q - 1) / 6;
  if (q === 0 && r <= 0) return 0;
  const S = (p * q) / 4;
  const r2 = sq(r);
  const r3 = r * r2;
  const disc = S * (S + 2 * r3);
  let u = r;
  if (disc >= 0) {
    let T3 = S + r3;
    T3 += T3 < 0 ? -Math.sqrt(disc) : Math.sqrt(disc);
    const T = Math.cbrt(T3);
    u += T + (T !== 0 ? r2 / T : 0);
  } else {
    u += 2 * r * Math.cos(Math.atan2(Math.sqrt(-disc), -(S + r3)) / 3);
  }
  const v = Math.sqrt(sq(u) + q);
  const uv = u < 0 ? q / (v - u) : u + v;
  const w = (uv - q) / (2 * v);
  return uv / (Math.sqrt(uv + sq(w)) + w);
}

function a1m1f(eps: number): number {
  const t = polyval(3, [1, 4, 64, 0, 256], 0, sq(eps)) / 256;
  return (t + eps) / (1 - eps);
}

function a2m1f(eps: number): number {
  const t = polyval(3, [-11, -28, -192, 0, 256], 0, sq(eps)) / 256;
  return (t - eps) / (1 + eps);
}

const C1_COEFF = [-1, 6, -16, 32, -9, 64, -128, 2048, 9, -16, 768, 3, -5, 512, -7, 1280, -7, 2048];
const C1P_COEFF = [205, -432, 768, 1536, 4005, -4736, 3840, 12288, -225, 116, 384, -7173, 2695, 7680, 3467, 7680, 38081, 61440];
const C2_COEFF = [1, 2, 16, 32, 35, 64, 384, 2048, 15, 80, 768, 7, 35, 512, 63, 1280, 77, 2048];

/** Fourier coefficients c[1..6] of an eps series table. */
function cSeries(coeff: readonly number[], eps: number, c: Float64Array): void {
  const eps2 = sq(eps);
  let d = eps;
  let o = 0;
  for (let l = 1; l <= ORDER; l++) {
    const m = (ORDER - l) >> 1;
    c[l] = (d * polyval(m, coeff, o, eps2)) / coeff[o + m + 1];
    o += m + 2;
    d *= eps;
  }
}

const A3X: number[] = (() => {
  const coeff = [-3, 128, -2, -3, 64, -1, -3, -1, 16, 3, -1, -2, 8, 1, -1, 2, 1, 1];
  const out: number[] = [];
  let o = 0;
  for (let j = ORDER - 1; j >= 0; j--) {
    const m = Math.min(ORDER - j - 1, j);
    out.push(polyval(m, coeff, o, N3) / coeff[o + m + 1]);
    o += m + 2;
  }
  return out;
})();

const C3X: number[] = (() => {
  const coeff = [3, 128, 2, 5, 128, -1, 3, 3, 64, -1, 0, 1, 8, -1, 1, 4, 5, 256, 1, 3, 128, -3, -2, 3, 64, 1, -3, 2, 32, 7, 512, -10, 9, 384, 5, -9, 5, 192, 7, 512, -14, 7, 512, 21, 2560];
  const out: number[] = [];
  let o = 0;
  for (let l = 1; l < ORDER; l++)
    for (let j = ORDER - 1; j >= l; j--) {
      const m = Math.min(ORDER - j - 1, j);
      out.push(polyval(m, coeff, o, N3) / coeff[o + m + 1]);
      o += m + 2;
    }
  return out;
})();

const a3f = (eps: number) => polyval(ORDER - 1, A3X, 0, eps);

function c3f(eps: number, c: Float64Array): void {
  let mult = 1;
  let o = 0;
  for (let l = 1; l < ORDER; l++) {
    const m = ORDER - l - 1;
    mult *= eps;
    c[l] = mult * polyval(m, C3X, o, eps);
    o += m + 1;
  }
}

const epsOf = (k2: number) => k2 / (2 * (1 + Math.sqrt(1 + k2)) + k2);

/** Scaled distance s12/b and reduced length m12/b; `m0` is the reduced-length series constant. */
function lengths(eps: number, sig12: number, ssig1: number, csig1: number, dn1: number, ssig2: number, csig2: number, dn2: number, wantS: boolean, C1a: Float64Array, C2a: Float64Array): { s12b: number; m12b: number; m0: number } {
  const A1 = a1m1f(eps);
  cSeries(C1_COEFF, eps, C1a);
  const A2 = a2m1f(eps);
  cSeries(C2_COEFF, eps, C2a);
  const m0x = A1 - A2;
  const B1 = sinCosSeries(true, ssig2, csig2, C1a) - sinCosSeries(true, ssig1, csig1, C1a);
  let J12: number;
  let s12b = NaN;
  if (wantS) {
    s12b = (1 + A1) * (sig12 + B1);
    const B2 = sinCosSeries(true, ssig2, csig2, C2a) - sinCosSeries(true, ssig1, csig1, C2a);
    J12 = m0x * sig12 + ((1 + A1) * B1 - (1 + A2) * B2);
  } else {
    for (let l = 1; l <= ORDER; l++) C2a[l] = (1 + A1) * C1a[l] - (1 + A2) * C2a[l];
    J12 = m0x * sig12 + (sinCosSeries(true, ssig2, csig2, C2a) - sinCosSeries(true, ssig1, csig1, C2a));
  }
  const m12b = dn2 * (csig1 * ssig2) - dn1 * (ssig1 * csig2) - csig1 * csig2 * J12;
  return { s12b, m12b, m0: m0x };
}

export interface Geodesic {
  /** Metres along the ellipsoid. */
  distM: number;
  /** Forward azimuth at the start, degrees in (-180, 180]. */
  azi1: number;
  /** Forward azimuth at the end. */
  azi2: number;
}

/** Karney's inverse problem: the shortest geodesic from a to b, antipodal pairs included. */
export function inverse(a: LngLat, b: LngLat): Geodesic {
  let [lon12, lon12s] = angDiff(a.lng, b.lng);
  let lonsign = copysign(1, lon12);
  lon12 *= lonsign;
  lon12s *= lonsign;
  const lam12 = lon12 * D2R;
  const [slam12, clam12] = sincosde(lon12, lon12s);
  lon12s = 180 - lon12 - lon12s;
  let lat1 = angRound(latFix(a.lat));
  let lat2 = angRound(latFix(b.lat));
  const swapp = Math.abs(lat1) < Math.abs(lat2) || Number.isNaN(lat2) ? -1 : 1;
  if (swapp < 0) {
    lonsign *= -1;
    [lat1, lat2] = [lat2, lat1];
  }
  const latsign = copysign(1, -lat1);
  lat1 *= latsign;
  lat2 *= latsign;
  let [sbet1, cbet1] = sincosd(lat1);
  [sbet1, cbet1] = norm(F1 * sbet1, cbet1);
  cbet1 = Math.max(TINY, cbet1);
  let [sbet2, cbet2] = sincosd(lat2);
  [sbet2, cbet2] = norm(F1 * sbet2, cbet2);
  cbet2 = Math.max(TINY, cbet2);
  if (cbet1 < -sbet1) {
    if (cbet2 === cbet1) sbet2 = copysign(sbet1, sbet2);
  } else if (Math.abs(sbet2) === -sbet1) cbet2 = cbet1;
  const dn1 = Math.sqrt(1 + EP2 * sq(sbet1));
  const dn2 = Math.sqrt(1 + EP2 * sq(sbet2));
  const C1a = new Float64Array(ORDER + 1);
  const C2a = new Float64Array(ORDER + 1);
  const C3a = new Float64Array(ORDER);
  let salp1 = 0;
  let calp1 = 0;
  let salp2 = 0;
  let calp2 = 0;
  let s12x = 0;
  let meridian = lat1 === -90 || slam12 === 0;
  if (meridian) {
    calp1 = clam12;
    salp1 = slam12;
    calp2 = 1;
    salp2 = 0;
    const ssig1 = sbet1;
    const csig1 = calp1 * cbet1;
    const ssig2 = sbet2;
    const csig2 = calp2 * cbet2;
    let sig12 = Math.atan2(Math.max(0, csig1 * ssig2 - ssig1 * csig2) + 0, csig1 * csig2 + ssig1 * ssig2);
    const l = lengths(N3, sig12, ssig1, csig1, dn1, ssig2, csig2, dn2, true, C1a, C2a);
    s12x = l.s12b;
    let m12x = l.m12b;
    if (sig12 < TOL2 || m12x >= 0) {
      if (sig12 < 3 * TINY || (sig12 < TOL0 && (s12x < 0 || m12x < 0))) sig12 = m12x = s12x = 0;
      s12x *= B;
    } else meridian = false;
  }
  if (!meridian && sbet1 === 0 && (WGS84_F <= 0 || lon12s >= WGS84_F * 180)) {
    calp1 = calp2 = 0;
    salp1 = salp2 = 1;
    s12x = WGS84_A * lam12;
  } else if (!meridian) {
    const st = inverseStart(sbet1, cbet1, sbet2, cbet2, lam12, slam12, clam12);
    salp1 = st.salp1;
    calp1 = st.calp1;
    if (st.sig12 >= 0) {
      salp2 = st.salp2;
      calp2 = st.calp2;
      s12x = st.sig12 * B * st.dnm;
    } else {
      let numit = 0;
      let tripn = false;
      let tripb = false;
      let salp1a = TINY;
      let calp1a = 1;
      let salp1b = TINY;
      let calp1b = -1;
      let r: Lambda12;
      for (;;) {
        r = lambda12(sbet1, cbet1, dn1, sbet2, cbet2, dn2, salp1, calp1, slam12, clam12, numit < MAXIT1, C1a, C2a, C3a);
        const v = r.lam12;
        if (tripb || !(Math.abs(v) >= (tripn ? 8 : 1) * TOL0) || numit === MAXIT2) break;
        if (v > 0 && (numit > MAXIT1 || calp1 / salp1 > calp1b / salp1b)) {
          salp1b = salp1;
          calp1b = calp1;
        } else if (v < 0 && (numit > MAXIT1 || calp1 / salp1 < calp1a / salp1a)) {
          salp1a = salp1;
          calp1a = calp1;
        }
        numit++;
        if (numit < MAXIT1 && r.dlam12 > 0) {
          const dalp1 = -v / r.dlam12;
          if (Math.abs(dalp1) < Math.PI) {
            const sdalp1 = Math.sin(dalp1);
            const cdalp1 = Math.cos(dalp1);
            const nsalp1 = salp1 * cdalp1 + calp1 * sdalp1;
            if (nsalp1 > 0) {
              [salp1, calp1] = norm(nsalp1, calp1 * cdalp1 - salp1 * sdalp1);
              tripn = Math.abs(v) <= 16 * TOL0;
              continue;
            }
          }
        }
        [salp1, calp1] = norm((salp1a + salp1b) / 2, (calp1a + calp1b) / 2);
        tripn = false;
        tripb = Math.abs(salp1a - salp1) + (calp1a - calp1) < TOLB || Math.abs(salp1 - salp1b) + (calp1 - calp1b) < TOLB;
      }
      salp2 = r.salp2;
      calp2 = r.calp2;
      s12x = lengths(r.eps, r.sig12, r.ssig1, r.csig1, dn1, r.ssig2, r.csig2, dn2, true, C1a, C2a).s12b * B;
    }
  }
  if (swapp < 0) {
    [salp1, salp2] = [salp2, salp1];
    [calp1, calp2] = [calp2, calp1];
  }
  salp1 *= swapp * lonsign;
  calp1 *= swapp * latsign;
  salp2 *= swapp * lonsign;
  calp2 *= swapp * latsign;
  return { distM: 0 + s12x, azi1: atan2d(salp1, calp1), azi2: atan2d(salp2, calp2) };
}

function inverseStart(sbet1: number, cbet1: number, sbet2: number, cbet2: number, lam12: number, slam12: number, clam12: number): { sig12: number; salp1: number; calp1: number; salp2: number; calp2: number; dnm: number } {
  let sig12 = -1;
  let salp2 = NaN;
  let calp2 = NaN;
  let dnm = NaN;
  const sbet12 = sbet2 * cbet1 - cbet2 * sbet1;
  const cbet12 = cbet2 * cbet1 + sbet2 * sbet1;
  const sbet12a = sbet2 * cbet1 + cbet2 * sbet1;
  const shortline = cbet12 >= 0 && sbet12 < 0.5 && cbet2 * lam12 < 0.5;
  let somg12: number;
  let comg12: number;
  if (shortline) {
    let sbetm2 = sq(sbet1 + sbet2);
    sbetm2 /= sbetm2 + sq(cbet1 + cbet2);
    dnm = Math.sqrt(1 + EP2 * sbetm2);
    const omg12 = lam12 / (F1 * dnm);
    somg12 = Math.sin(omg12);
    comg12 = Math.cos(omg12);
  } else {
    somg12 = slam12;
    comg12 = clam12;
  }
  let salp1 = cbet2 * somg12;
  let calp1 = comg12 >= 0 ? sbet12 + (cbet2 * sbet1 * sq(somg12)) / (1 + comg12) : sbet12a - (cbet2 * sbet1 * sq(somg12)) / (1 - comg12);
  const ssig12 = Math.hypot(salp1, calp1);
  const csig12 = sbet1 * sbet2 + cbet1 * cbet2 * comg12;
  if (shortline && ssig12 < ETOL2) {
    [salp2, calp2] = norm(cbet1 * somg12, sbet12 - cbet1 * sbet2 * (comg12 >= 0 ? sq(somg12) / (1 + comg12) : 1 - comg12));
    sig12 = Math.atan2(ssig12, csig12);
  } else if (Math.abs(N3) >= 0.1 || csig12 >= 0 || ssig12 >= 6 * Math.abs(N3) * Math.PI * sq(cbet1)) {
    // Nothing: the zeroth-order guess is good enough.
  } else {
    // Nearly antipodal: solve the astroid problem (oblate branch only).
    const lam12x = Math.atan2(-slam12, -clam12);
    const k2 = sq(sbet1) * EP2;
    const lamscale = WGS84_F * cbet1 * a3f(epsOf(k2)) * Math.PI;
    const betscale = lamscale * cbet1;
    const x = lam12x / lamscale;
    const y = sbet12a / betscale;
    if (y > -TOL1 && x > -1 - XTHRESH) {
      salp1 = Math.min(1, -x);
      calp1 = -Math.sqrt(1 - sq(salp1));
    } else {
      const k = astroid(x, y);
      const omg12a = lamscale * ((-x * k) / (1 + k));
      somg12 = Math.sin(omg12a);
      comg12 = -Math.cos(omg12a);
      salp1 = cbet2 * somg12;
      calp1 = sbet12a - (cbet2 * sbet1 * sq(somg12)) / (1 - comg12);
    }
  }
  if (!(salp1 <= 0)) [salp1, calp1] = norm(salp1, calp1);
  else {
    salp1 = 1;
    calp1 = 0;
  }
  return { sig12, salp1, calp1, salp2, calp2, dnm };
}

interface Lambda12 {
  lam12: number;
  salp2: number;
  calp2: number;
  sig12: number;
  ssig1: number;
  csig1: number;
  ssig2: number;
  csig2: number;
  eps: number;
  dlam12: number;
}

function lambda12(sbet1: number, cbet1: number, dn1: number, sbet2: number, cbet2: number, dn2: number, salp1: number, calp1: number, slam120: number, clam120: number, diffp: boolean, C1a: Float64Array, C2a: Float64Array, C3a: Float64Array): Lambda12 {
  if (sbet1 === 0 && calp1 === 0) calp1 = -TINY;
  const salp0 = salp1 * cbet1;
  const calp0 = Math.hypot(calp1, salp1 * sbet1);
  const somg1 = salp0 * sbet1;
  const comg1 = calp1 * cbet1;
  const [ssig1, csig1] = norm(sbet1, comg1);
  const salp2 = cbet2 !== cbet1 ? salp0 / cbet2 : salp1;
  const calp2 = cbet2 !== cbet1 || Math.abs(sbet2) !== -sbet1 ? Math.sqrt(sq(calp1 * cbet1) + (cbet1 < -sbet1 ? (cbet2 - cbet1) * (cbet1 + cbet2) : (sbet1 - sbet2) * (sbet1 + sbet2))) / cbet2 : Math.abs(calp1);
  const somg2 = salp0 * sbet2;
  const comg2 = calp2 * cbet2;
  const [ssig2, csig2] = norm(sbet2, comg2);
  const sig12 = Math.atan2(Math.max(0, csig1 * ssig2 - ssig1 * csig2) + 0, csig1 * csig2 + ssig1 * ssig2);
  const somg12 = Math.max(0, comg1 * somg2 - somg1 * comg2) + 0;
  const comg12 = comg1 * comg2 + somg1 * somg2;
  const eta = Math.atan2(somg12 * clam120 - comg12 * slam120, comg12 * clam120 + somg12 * slam120);
  const eps = epsOf(sq(calp0) * EP2);
  c3f(eps, C3a);
  const B312 = sinCosSeries(true, ssig2, csig2, C3a) - sinCosSeries(true, ssig1, csig1, C3a);
  const lam12 = eta - WGS84_F * a3f(eps) * salp0 * (sig12 + B312);
  let dlam12 = NaN;
  if (diffp) {
    if (calp2 === 0) dlam12 = (-2 * F1 * dn1) / sbet1;
    else dlam12 = (lengths(eps, sig12, ssig1, csig1, dn1, ssig2, csig2, dn2, false, C1a, C2a).m12b * F1) / (calp2 * cbet2);
  }
  return { lam12, salp2, calp2, sig12, ssig1, csig1, ssig2, csig2, eps, dlam12 };
}

/**
 * A geodesic from `from` along `bearing`: returns the point `distM` along it. Setup is one inverse's
 * worth of series; each point after is a few trig calls. Longitude is unrolled, so it stays continuous.
 */
export function geodesicLine(from: LngLat, bearing: number): (distM: number) => LngLat {
  const lat1 = latFix(from.lat);
  const [salp1, calp1] = sincosd(angRound(bearing));
  let [sbet1, cbet1] = sincosd(angRound(lat1));
  [sbet1, cbet1] = norm(F1 * sbet1, cbet1);
  cbet1 = Math.max(TINY, cbet1);
  const salp0 = salp1 * cbet1;
  const calp0 = Math.hypot(calp1, salp1 * sbet1);
  const somg1 = salp0 * sbet1;
  const comg1 = sbet1 !== 0 || calp1 !== 0 ? cbet1 * calp1 : 1;
  const [ssig1, csig1] = norm(sbet1, comg1);
  const k2 = sq(calp0) * EP2;
  const eps = epsOf(k2);
  const A1m1 = a1m1f(eps);
  const C1a = new Float64Array(ORDER + 1);
  cSeries(C1_COEFF, eps, C1a);
  const B11 = sinCosSeries(true, ssig1, csig1, C1a);
  const stau1 = ssig1 * Math.cos(B11) + csig1 * Math.sin(B11);
  const ctau1 = csig1 * Math.cos(B11) - ssig1 * Math.sin(B11);
  const C1pa = new Float64Array(ORDER + 1);
  cSeries(C1P_COEFF, eps, C1pa);
  const C3a = new Float64Array(ORDER);
  c3f(eps, C3a);
  const A3c = -WGS84_F * salp0 * a3f(eps);
  const B31 = sinCosSeries(true, ssig1, csig1, C3a);
  const E = copysign(1, salp0);
  const sig1 = Math.atan2(ssig1, csig1);
  const omg1 = Math.atan2(E * somg1, comg1);
  return (distM) => {
    const tau12 = distM / (B * (1 + A1m1));
    const s = Math.sin(tau12);
    const c = Math.cos(tau12);
    const B12 = -sinCosSeries(true, stau1 * c + ctau1 * s, ctau1 * c - stau1 * s, C1pa);
    const sig12 = tau12 - (B12 - B11);
    const ssig12 = Math.sin(sig12);
    const csig12 = Math.cos(sig12);
    const ssig2 = ssig1 * csig12 + csig1 * ssig12;
    let csig2 = csig1 * csig12 - ssig1 * ssig12;
    const sbet2 = calp0 * ssig2;
    let cbet2 = Math.hypot(salp0, calp0 * csig2);
    if (cbet2 === 0) cbet2 = csig2 = TINY;
    const omg12 = E * (sig12 - (Math.atan2(ssig2, csig2) - sig1) + (Math.atan2(E * salp0 * ssig2, csig2) - omg1));
    const lam12 = omg12 + A3c * (sig12 + (sinCosSeries(true, ssig2, csig2, C3a) - B31));
    return { lng: from.lng + lam12 * R2D, lat: atan2d(sbet2, F1 * cbet2) };
  };
}

/** Geodesic distance in metres. */
export function distanceM(a: LngLat, b: LngLat): number {
  return inverse(a, b).distM;
}

/** Initial geodesic bearing from a to b, degrees clockwise from true north. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  return normalizeBearing(inverse(a, b).azi1);
}

/** Point reached travelling `distM` along the geodesic that leaves `from` at `bearing`. */
export function destination(from: LngLat, bearing: number, distM: number): LngLat {
  const p = geodesicLine(from, bearing)(distM);
  return { lng: angNormalize(p.lng), lat: p.lat };
}

/**
 * Densified geodesic ray as GeoJSON positions, so long lines stay geodesic on a Mercator map (TPE
 * draws FOV edges this way). Longitude runs continuous across the antimeridian for rendering.
 */
export function geodesicRay(from: LngLat, bearing: number, distM: number, segments = 32): [number, number][] {
  const at = geodesicLine(from, bearing);
  const out: [number, number][] = [[from.lng, from.lat]];
  for (let i = 1; i <= segments; i++) {
    const p = at((distM * i) / segments);
    out.push([p.lng, p.lat]);
  }
  return out;
}

/** Standard terrestrial refraction coefficient; light bends down, so the Earth looks slightly flatter. */
export const REFRACTION_K = 0.13;

/** Curvature drop of the surface below the observer's tangent plane at `distM`, refraction included. */
export function curvatureDropM(distM: number, k = REFRACTION_K): number {
  return distM ** 2 / (2 * (EARTH_RADIUS_M / (1 - k)));
}

/** Elevation angle from observer to a target given horizontal distance and height difference. */
export function elevationAngleDeg(distM: number, dHeightM: number, k = REFRACTION_K): number {
  return Math.atan2(dHeightM - curvatureDropM(distM, k), distM) * R2D;
}

/** Inverse of `elevationAngleDeg`: height of a point seen at `angleDeg` from an eye at `eyeM`. */
export function heightAtAngle(eyeM: number, distM: number, angleDeg: number, k = REFRACTION_K): number {
  return eyeM + distM * Math.tan(angleDeg * D2R) + curvatureDropM(distM, k);
}

/** The geodesic from a to b as a function of the fraction along it; one inverse, then a direct per call. */
export function geodesicBetween(a: LngLat, b: LngLat): (f: number) => LngLat {
  const g = inverse(a, b);
  if (g.distM === 0) return () => ({ ...a });
  const at = geodesicLine(a, g.azi1);
  return (f) => at(f * g.distM);
}

/** Point a fraction `f` (0..1) along the geodesic from a to b. */
export function intermediatePoint(a: LngLat, b: LngLat, f: number): LngLat {
  const p = geodesicBetween(a, b)(f);
  return { lng: normalizeLng(p.lng), lat: p.lat };
}

/** Densified geodesic path from a to b as GeoJSON positions, longitude kept continuous. */
export function geodesicPath(a: LngLat, b: LngLat, segments = 32): [number, number][] {
  const at = geodesicBetween(a, b);
  const out: [number, number][] = [[a.lng, a.lat]];
  for (let i = 1; i <= segments; i++) {
    const p = at(i / segments);
    out.push([p.lng, p.lat]);
  }
  return out;
}
