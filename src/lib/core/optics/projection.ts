const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** East, north, up unit vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function dirFromAzAlt(azDeg: number, altDeg: number): Vec3 {
  const az = azDeg * D2R;
  const alt = altDeg * D2R;
  const c = Math.cos(alt);
  return { x: Math.sin(az) * c, y: Math.cos(az) * c, z: Math.sin(alt) };
}

export function azAltFromDir(v: Vec3): { azimuthDeg: number; altitudeDeg: number } {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  const az = Math.atan2(v.x, v.y) * R2D;
  return { azimuthDeg: ((az % 360) + 360) % 360, altitudeDeg: Math.asin(v.z / len) * R2D };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** A level (roll-free) rectilinear camera: where it points and its frame in sensor millimetres. */
export interface Camera {
  azimuthDeg: number;
  elevationDeg: number;
  focalMm: number;
  /** Frame size in the shooting orientation. */
  frameWmm: number;
  frameHmm: number;
}

export interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export function cameraBasis(cam: Pick<Camera, 'azimuthDeg' | 'elevationDeg'>): CameraBasis {
  const forward = dirFromAzAlt(cam.azimuthDeg, cam.elevationDeg);
  const right = dirFromAzAlt(cam.azimuthDeg + 90, 0);
  return { forward, right, up: cross(right, forward) };
}

export interface SensorPoint {
  /** Millimetres right of the frame centre. */
  x: number;
  /** Millimetres above the frame centre. */
  y: number;
  /** Cosine of the angle off the optical axis; ≤ 0 means behind the camera. */
  depth: number;
}

/** Projects a sky direction onto the sensor plane; null when it lies behind the camera. */
export function projectDir(cam: Camera, basis: CameraBasis, d: Vec3): SensorPoint | null {
  const depth = dot(d, basis.forward);
  if (depth <= 1e-6) return null;
  return { x: (dot(d, basis.right) / depth) * cam.focalMm, y: (dot(d, basis.up) / depth) * cam.focalMm, depth };
}

export function project(cam: Camera, basis: CameraBasis, azDeg: number, altDeg: number): SensorPoint | null {
  return projectDir(cam, basis, dirFromAzAlt(azDeg, altDeg));
}

/** Sky direction seen at a sensor position. */
export function unproject(cam: Camera, basis: CameraBasis, xMm: number, yMm: number): { azimuthDeg: number; altitudeDeg: number } {
  const f = cam.focalMm;
  const { forward: F, right: R, up: U } = basis;
  const v: Vec3 = { x: F.x + (xMm / f) * R.x + (yMm / f) * U.x, y: F.y + (xMm / f) * R.y + (yMm / f) * U.y, z: F.z + (xMm / f) * R.z + (yMm / f) * U.z };
  return azAltFromDir(v);
}

export function inFrame(cam: Camera, p: SensorPoint): boolean {
  return Math.abs(p.x) <= cam.frameWmm / 2 + 1e-9 && Math.abs(p.y) <= cam.frameHmm / 2 + 1e-9;
}

/** Radius on the sensor of a disc with angular radius `radiusDeg` near the axis. */
export function discRadiusMm(cam: Camera, radiusDeg: number): number {
  return cam.focalMm * Math.tan(radiusDeg * D2R);
}
