/** The building prisms drawn on the GPU with the viewfinder's pinhole projection. */

import { HAZE_M, MIN_AREA_PX, MIN_PX, NEAR_M, ROOF_SHADE, type PrismShading, type PrismTile } from '@core/geo/prismRaster';
import { prismSurfaces, type SurfaceMesh } from '@core/geo/surfaces';
import type { Camera, CameraBasis } from '@core/optics/projection';
import { boxCastsInto, coneDepthRange, type Cascade, type SceneBounds } from './shadowFit';

/** Every per-building and per-surface table is a texture this wide. */
const TEX_W = 1024;

export interface PrismGlStats {
  /** Buildings in the tiles submitted; the per-building culls now run in the vertex shader. */
  buildings: number;
  tiles: number;
  triangles: number;
  /** Precise models drawn, and their triangles. */
  models: number;
  modelTriangles: number;
}

export interface PrismDepthStats {
  triangles: number;
  modelTriangles: number;
}

/** One surface mesh's triangles, uploaded once and reused until it is dropped. */
interface TileMesh {
  vao: WebGLVertexArrayObject;
  indexCount: number;
  /** Per-surface plane `N·P = pc`, as an RGBA32F table. */
  planeTex: WebGLTexture;
  /** Per-surface kind, bearing, horizontality and distance: everything the shading needs. */
  surfTex: WebGLTexture;
  /** Per-building bounding sphere, and the sizes the sub-pixel cull needs. */
  sphereTex: WebGLTexture;
  sizeTex: WebGLTexture;
  /** minE, minN, minU, maxE, maxN, maxU, for the per-cascade caster cull. */
  box: Float32Array;
  doubleSided: boolean;
}

const CULL_GLSL = `
const float NEAR_M = ${NEAR_M.toFixed(4)};
const float MIN_PX = ${MIN_PX.toFixed(4)};
const float MIN_AREA_PX = ${MIN_AREA_PX.toFixed(4)};
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uFocal;
uniform float uWmm;
uniform float uHmm;
uniform float uPxPerM;
uniform float uRangeM;
uniform float uConeRad;

bool sphereVisible(vec3 c, float r) {
  float depth = dot(c, uFwd);
  if (depth + r <= NEAR_M) return false;
  if (depth > r + NEAR_M) {
    float rm = (r / depth) * uFocal;
    return abs((dot(c, uRight) / depth) * uFocal) - rm <= uWmm * 0.5 && abs((dot(c, uUp) / depth) * uFocal) - rm <= uHmm * 0.5;
  }
  float l = length(c);
  if (l < 1e-6) return false;
  return acos(clamp(depth / l, -1.0, 1.0)) - asin(min(1.0, r / l)) <= uConeRad;
}

/** The per-building culls, moved off the per-frame CPU path. */
bool buildingVisible(vec4 sphere, vec4 size) {
  if (size.w < 0.5) return false;
  // A precise model is drawn at any range and any size.
  if (size.w < 1.5) {
    float dist = max(1.0, size.x);
    if (dist > uRangeM) return false;
    float k = uPxPerM / dist;
    float wPx = size.y * k;
    float hPx = size.z * k;
    if (wPx < MIN_PX && hPx < MIN_PX) return false;
    if (wPx * hPx < MIN_AREA_PX) return false;
  }
  return sphereVisible(sphere.xyz, sphere.w);
}
`;

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aSurf;
layout(location = 2) in float aBldg;
uniform mat4 uProj;
uniform highp sampler2D uSphere;
uniform highp sampler2D uSize;
${CULL_GLSL}
flat out int vSurf;
void main() {
  int b = int(aBldg);
  ivec2 bt = ivec2(b % ${TEX_W}, b / ${TEX_W});
  vSurf = int(aSurf);
  // A culled building collapses to a point, so its triangles cover nothing.
  gl_Position = buildingVisible(texelFetch(uSphere, bt, 0), texelFetch(uSize, bt, 0)) ? uProj * vec4(aPos, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
const float D2R = 3.141592653589793 / 180.0;
const float HAZE_M = ${HAZE_M.toFixed(1)};
const float ROOF_SHADE = ${ROOF_SHADE.toFixed(4)};
const vec3 BASE = vec3(244.0, 244.0, 246.0);
flat in int vSurf;
uniform highp sampler2D uPlane;
uniform highp sampler2D uSurf;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uFocal;
uniform float uWmm;
uniform float uHmm;
uniform vec2 uRes;
uniform float uLightAz;
uniform vec3 uHazeRgb;
uniform float uNight;
uniform float uDouble;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oPos;
layout(location = 2) out vec4 oNormal;
void main() {
  ivec2 st = ivec2(vSurf % ${TEX_W}, vSurf / ${TEX_W});
  vec4 pl = texelFetch(uPlane, st, 0);
  // The pinhole ray for this pixel, rebuilt from the fragment's own centre.
  float aMm = (gl_FragCoord.x / uRes.x - 0.5) * uWmm / uFocal;
  float bMm = (gl_FragCoord.y / uRes.y - 0.5) * uHmm / uFocal;
  vec3 d = uFwd + aMm * uRight + bMm * uUp;
  float den = dot(pl.xyz, d);
  if (den == 0.0) discard;
  vec4 su = texelFetch(uSurf, st, 0);
  // An open mesh shows either side, so its plane faces whichever side the eye is on.
  if (uDouble > 0.5 && den > 0.0) {
    pl = -pl;
    den = -den;
    su.y += 180.0;
  }
  float ray = pl.w / den;
  if (!(ray > 0.0)) discard;
  float clear = exp(-su.w / HAZE_M);
  float lit = 0.55 + 0.45 * (0.5 + 0.5 * cos((su.y - uLightAz) * D2R));
  float k = su.x > 0.5 ? (su.z < 1e-4 ? ROOF_SHADE : ROOF_SHADE + su.z * (lit - ROOF_SHADE)) : lit;
  float dim = k * clear * (1.0 - 0.45 * uNight);
  oColor = vec4((BASE * dim + uHazeRgb * (1.0 - clear)) / 255.0, 1.0);
  oPos = vec4(ray * d, 1.0);
  // Alpha marks a model face for the composite's shadow bias.
  oNormal = vec4(pl.xyz * 0.5 + 0.5, uDouble > 0.5 ? 0.5 : 1.0);
}
`;

const DEPTH_VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uProj;
void main() {
  gl_Position = uProj * vec4(aPos, 1.0);
}
`;

const DEPTH_FRAG_SRC = `#version 300 es
precision highp float;
void main() {}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`prismGl shader: ${gl.getShaderInfoLog(sh)}`);
  return sh;
}

export function linkProgram(gl: WebGL2RenderingContext, vert: string, frag: string, what: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${what} link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

export function uniforms(gl: WebGL2RenderingContext, prog: WebGLProgram, names: readonly string[]): Record<string, WebGLUniformLocation | null> {
  return Object.fromEntries(names.map((k) => [k, gl.getUniformLocation(prog, k)]));
}

const texRows = (n: number) => Math.max(1, Math.ceil(n / TEX_W));

function table(gl: WebGL2RenderingContext, n: number, data: Float32Array): WebGLTexture {
  const rows = texRows(n);
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, TEX_W, rows);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const padded = new Float32Array(TEX_W * rows * 4);
  padded.set(data.subarray(0, Math.min(data.length, padded.length)));
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, rows, gl.RGBA, gl.FLOAT, padded);
  return t;
}

/**
 * The viewfinder's pinhole ray, written as a clip matrix. A pixel centre lands at
 * `xMm = (R·P / F·P) f`, the frame spans `wMm` across the raster, so `ndc.x = 2 f (R·P) / (wMm F·P)`;
 * `ndc.y` is the same with `U` and `hMm`, which is all portrait needs. `z` puts the near plane at
 * `F·P = NEAR_M` and leaves no far plane at all.
 */
export function prismClipMatrix(cam: Camera, basis: CameraBasis): Float32Array {
  const { forward: F, right: R, up: U } = basis;
  const kx = (2 * cam.focalMm) / cam.frameWmm;
  const ky = (2 * cam.focalMm) / cam.frameHmm;
  // Column-major: gl_Position = M * vec4(e, n, u, 1).
  return new Float32Array([kx * R.x, ky * U.x, -F.x, F.x, kx * R.y, ky * U.y, -F.y, F.y, kx * R.z, ky * U.z, -F.z, F.z, 0, 0, 2 * NEAR_M, 0]);
}

const MAIN_UNIFORMS = ['uProj', 'uSphere', 'uSize', 'uPlane', 'uSurf', 'uFwd', 'uRight', 'uUp', 'uFocal', 'uWmm', 'uHmm', 'uPxPerM', 'uRangeM', 'uConeRad', 'uRes', 'uLightAz', 'uHazeRgb', 'uNight', 'uDouble'];

/** Draws the cached prism tiles and the precise models; the caller owns the framebuffer it draws into. */
export class PrismGl {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly depthProg: WebGLProgram;
  private readonly uni: Record<string, WebGLUniformLocation | null>;
  private readonly depthUni: Record<string, WebGLUniformLocation | null>;
  private readonly tileMeshes = new WeakMap<PrismTile, TileMesh>();
  private readonly meshes = new WeakMap<SurfaceMesh, TileMesh>();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = linkProgram(gl, VERT_SRC, FRAG_SRC, 'prismGl');
    this.depthProg = linkProgram(gl, DEPTH_VERT_SRC, DEPTH_FRAG_SRC, 'prismGl depth');
    this.uni = uniforms(gl, this.prog, MAIN_UNIFORMS);
    this.depthUni = uniforms(gl, this.depthProg, ['uProj']);
  }

  /**
   * Extent and height range of the tiles submitted, in the same frame as the terrain's, so the
   * cascades cover towers that stand hundreds of metres above the terrain band. The cone range is
   * taken per tile rather than over the union, which a city-wide box would smear to nothing.
   */
  bounds(cam: Camera, basis: CameraBasis, tiles: Iterable<PrismTile>, models: Iterable<SurfaceMesh> = []): SceneBounds | null {
    let halfM = 1;
    let minU = Infinity;
    let maxU = -Infinity;
    let viewNearM = Infinity;
    let viewFarM = -Infinity;
    let any = false;
    for (const mesh of this.all(tiles, models)) {
      if (mesh.indexCount === 0) continue;
      const box = mesh.box;
      any = true;
      halfM = Math.max(halfM, Math.abs(box[0]), Math.abs(box[3]), Math.abs(box[1]), Math.abs(box[4]));
      minU = Math.min(minU, box[2]);
      maxU = Math.max(maxU, box[5]);
      const seen = coneDepthRange(box, 0, basis, cam);
      if (!seen) continue;
      viewNearM = Math.min(viewNearM, seen[0]);
      viewFarM = Math.max(viewFarM, seen[1]);
    }
    if (!any) return null;
    if (viewFarM <= viewNearM) return { halfM, minU, maxU };
    return { halfM, minU, maxU, viewNearM: Math.max(1, viewNearM), viewFarM };
  }

  /** Shades every visible prism into the bound G-buffer. */
  render(cam: Camera, basis: CameraBasis, tiles: Iterable<PrismTile>, sh: PrismShading, rw: number, rh: number, models: Iterable<SurfaceMesh> = []): PrismGlStats {
    const gl = this.gl;
    // The prisms are closed, so the eye only ever sees the faces winding counter-clockwise at it.
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.useProgram(this.prog);
    const u = this.uni;
    gl.uniformMatrix4fv(u.uProj, false, prismClipMatrix(cam, basis));
    this.cullUniforms(u, cam, basis, sh, rw);
    gl.uniform2f(u.uRes, rw, rh);
    gl.uniform1f(u.uLightAz, sh.lightAzDeg);
    gl.uniform3f(u.uHazeRgb, sh.hazeRgb[0], sh.hazeRgb[1], sh.hazeRgb[2]);
    gl.uniform1f(u.uNight, sh.night);
    gl.uniform1i(u.uSphere, 0);
    gl.uniform1i(u.uSize, 1);
    gl.uniform1i(u.uPlane, 2);
    gl.uniform1i(u.uSurf, 3);
    gl.uniform1f(u.uDouble, 0);

    let buildings = 0;
    let tileCount = 0;
    let triangles = 0;
    for (const tile of tiles) {
      const mesh = this.tileMesh(tile);
      if (mesh.indexCount === 0) continue;
      tileCount++;
      buildings += tile.count;
      this.draw(mesh);
      triangles += mesh.indexCount / 3;
    }
    // After the prisms, into the same depth, so the nearer surface wins wherever they meet.
    let modelCount = 0;
    let modelTriangles = 0;
    for (const m of models) {
      const mesh = this.upload(m);
      if (mesh.indexCount === 0) continue;
      modelCount++;
      if (mesh.doubleSided) gl.disable(gl.CULL_FACE);
      else gl.enable(gl.CULL_FACE);
      gl.uniform1f(u.uDouble, mesh.doubleSided ? 1 : 0);
      this.draw(mesh);
      modelTriangles += mesh.indexCount / 3;
    }
    gl.bindVertexArray(null);
    // The terrain and the shadow pass share this context and want every face.
    gl.disable(gl.CULL_FACE);
    return { buildings, tiles: tileCount, triangles, models: modelCount, modelTriangles };
  }

  private draw(mesh: TileMesh): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mesh.sphereTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mesh.sizeTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, mesh.planeTex);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, mesh.surfTex);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
  }

  /** Depth only, from the light's point of view; every prism casts, whatever the camera can see. */
  renderDepth(cascade: Cascade, light: CameraBasis, tiles: Iterable<PrismTile>, models: Iterable<SurfaceMesh> = []): PrismDepthStats {
    const gl = this.gl;
    gl.useProgram(this.depthProg);
    gl.uniformMatrix4fv(this.depthUni.uProj, false, cascade.matrix);
    const cast = (mesh: TileMesh) => {
      if (mesh.indexCount === 0 || !boxCastsInto(mesh.box, 0, light, cascade)) return 0;
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
      return mesh.indexCount / 3;
    };
    let triangles = 0;
    let modelTriangles = 0;
    for (const tile of tiles) triangles += cast(this.tileMesh(tile));
    for (const m of models) modelTriangles += cast(this.upload(m));
    gl.bindVertexArray(null);
    return { triangles, modelTriangles };
  }

  dispose(): void {
    this.gl.deleteProgram(this.prog);
    this.gl.deleteProgram(this.depthProg);
  }

  private cullUniforms(u: Record<string, WebGLUniformLocation | null>, cam: Camera, basis: CameraBasis, sh: PrismShading, rw: number): void {
    const gl = this.gl;
    const f = cam.focalMm;
    gl.uniform3f(u.uFwd, basis.forward.x, basis.forward.y, basis.forward.z);
    gl.uniform3f(u.uRight, basis.right.x, basis.right.y, basis.right.z);
    gl.uniform3f(u.uUp, basis.up.x, basis.up.y, basis.up.z);
    gl.uniform1f(u.uFocal, f);
    gl.uniform1f(u.uWmm, cam.frameWmm);
    gl.uniform1f(u.uHmm, cam.frameHmm);
    gl.uniform1f(u.uPxPerM, (f * rw) / cam.frameWmm);
    gl.uniform1f(u.uRangeM, sh.rangeM);
    gl.uniform1f(u.uConeRad, Math.atan(Math.hypot(cam.frameWmm, cam.frameHmm) / 2 / f));
  }

  private *all(tiles: Iterable<PrismTile>, models: Iterable<SurfaceMesh>): Generator<TileMesh> {
    for (const tile of tiles) yield this.tileMesh(tile);
    for (const m of models) yield this.upload(m);
  }

  private tileMesh(tile: PrismTile): TileMesh {
    const hit = this.tileMeshes.get(tile);
    if (hit) return hit;
    const mesh = this.upload(prismSurfaces(tile));
    this.tileMeshes.set(tile, mesh);
    return mesh;
  }

  private upload(m: SurfaceMesh): TileMesh {
    const hit = this.meshes.get(m);
    if (hit) return hit;
    const gl = this.gl;
    const nv = m.pos.length / 3;
    const inter = new Float32Array(nv * 5);
    for (let j = 0; j < nv; j++) {
      inter[j * 5] = m.pos[j * 3];
      inter[j * 5 + 1] = m.pos[j * 3 + 1];
      inter[j * 5 + 2] = m.pos[j * 3 + 2];
      inter[j * 5 + 3] = m.surfId[j];
      inter[j * 5 + 4] = m.bldgId[j];
    }
    // The element binding belongs to the bound VAO, so bind this mesh's own before touching buffers.
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);
    gl.bindVertexArray(null);

    const ns = Math.max(1, m.surf.length / 4);
    const nb = Math.max(1, m.sphere.length / 4);
    const mesh: TileMesh = {
      vao,
      indexCount: m.idx.length,
      box: m.box,
      doubleSided: m.doubleSided,
      planeTex: table(gl, ns, m.plane),
      surfTex: table(gl, ns, m.surf),
      sphereTex: table(gl, nb, m.sphere),
      sizeTex: table(gl, nb, m.size)
    };
    this.meshes.set(m, mesh);
    return mesh;
  }
}
