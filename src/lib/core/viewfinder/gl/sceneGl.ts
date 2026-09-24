/**
 * The viewfinder's picture: a G-buffer pass for the terrain mesh and the building prisms, a
 * cascaded shadow map along the sun, and a fullscreen composite that adds the sky, the Milky Way
 * and the sun and moon discs. The discs are drawn here because only here is the geometry depth
 * known, so a disc straddling a tower edge clips instead of popping.
 */

import type { PrismShading, PrismTile } from '@core/geo/prismRaster';
import type { SurfaceMesh } from '@core/geo/surfaces';
import { cameraBasis, type Camera, type CameraBasis } from '@core/optics/projection';
import type { MeshLevel } from '@core/terrain/mesh';
import { GROUND_HAZE_M, SKY } from '../palette';
import { linkProgram, PrismGl, uniforms, type PrismGlStats } from './prismGl';
import { CASCADE_COUNT, fitCascades, lightBasis, mergeScene, type Cascade, type SceneBounds } from './shadowFit';
import { SHADOW_GLSL, SHADOW_UNIFORMS, ShadowGl } from './shadowGl';
import { TerrainGl, type TerrainGlStats } from './terrainGl';

/** Equirectangular J2000 sky image, as the sky store holds it. */
export interface SceneGlTexture {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** A sun or moon disc, clipped against the picture's own depth. */
export interface BodyDisc {
  /** Unit direction in the eye-relative ENU frame. */
  dir: readonly [number, number, number];
  semiDeg: number;
  /** The moon as a lit sphere; null for the sun, which also glows. */
  moon: MoonShading | null;
}

export interface MoonShading {
  /** ENU → selenographic body frame, row major. */
  enuToBody: Float64Array;
  /** Unit vector from the moon to the sun, ENU. */
  sunDir: readonly [number, number, number];
  /** Weight of the Earth-lit dark side, 0..1. */
  earthshine: number;
  map: SceneGlTexture | null;
}

export interface SceneGlInput {
  cam: Camera;
  basis: CameraBasis;
  eyeAboveGroundM: number;
  /** Flat-horizon dip used until the terrain mesh arrives. */
  fallbackDeg: number;
  /** Daylight and dusk weights of the palette, and the two ends of its ground ramp. */
  day: number;
  dusk: number;
  groundNear: readonly number[];
  groundFar: readonly number[];
  terrain: readonly MeshLevel[];
  /** Prisms and precise models share the shading and the buildings toggle. */
  prism: { tiles: Iterable<PrismTile>; models: Iterable<SurfaceMesh>; shading: PrismShading } | null;
  milkyWay: SceneGlTexture | null;
  /** ENU → equatorial J2000, row major; null when the Milky Way is not drawn. */
  eqj: Float64Array | null;
  mwGain: number;
  /** Where the body casting the shadows is; they are cast only while it is up. */
  lightAzDeg: number;
  lightAltDeg: number;
  shadowGain: number;
  /** Nonzero when that body is the moon: lit ground brightens instead of shade darkening. */
  moonlight: number;
  sunDisc: BodyDisc | null;
  moonDisc: BodyDisc | null;
}

export interface SceneGlStats {
  prism: PrismGlStats | null;
  terrain: TerrainGlStats | null;
  cascades: number;
  shadowTriangles: number;
  /** The prisms' share of them; walls now cast from both sides, so it is worth watching. */
  shadowPrismTriangles: number;
  shadowModelTriangles: number;
  /** Per cascade: axial far edge and the two texel sizes, metres; a long lens makes them differ a lot. */
  cascadeInfo: { farM: number; texelXM: number; texelYM: number }[];
  /** Axial depth range the view cone touches, metres, when the terrain reported one. */
  viewRangeM: [number, number] | null;
  /** GPU time of the whole picture when EXT_disjoint_timer_query_webgl2 is present, else -1. */
  gpuMs: number;
}

/** The only part of EXT_disjoint_timer_query_webgl2 this uses; it is not in lib.dom. */
interface TimerExt {
  TIME_ELAPSED_EXT: number;
}

const VERT_SRC = `#version 300 es
void main() {
  // One triangle covering clip space; no attributes, no buffers.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;

const float PI = 3.141592653589793;
const float D2R = PI / 180.0;
const float HAZE_M = ${GROUND_HAZE_M.toFixed(1)};
const vec3 ZENITH_DAY = vec3(${SKY.zenithDay.join('.0, ')}.0);
const vec3 HORIZON_DAY = vec3(${SKY.horizonDay.join('.0, ')}.0);
const vec3 ZENITH_NIGHT = vec3(${SKY.zenithNight.join('.0, ')}.0);
const vec3 HORIZON_NIGHT = vec3(${SKY.horizonNight.join('.0, ')}.0);
const vec3 DUSK_GLOW = vec3(${SKY.duskGlow.join('.0, ')}.0);
const vec3 SUN_RGB = vec3(255.0, 243.0, 196.0);
const vec3 SUN_GLOW_RGB = vec3(255.0, 220.0, 120.0);
const vec3 MOON_LIT_RGB = vec3(232.0, 238.0, 245.0);
const vec3 EARTHSHINE_RGB = vec3(34.0, 38.0, 46.0);
const vec3 MOONLIGHT_RGB = vec3(3.0, 5.0, 12.0);
/** Mean luminance of moon.jpg, so the map shifts the albedo around 1. */
const float MOON_MEAN_ALBEDO = 0.586;

uniform vec2 uOrigin;
uniform vec2 uRes;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uFocal;
uniform float uWmm;
uniform float uHmm;

uniform float uDay;
uniform float uDusk;
uniform vec3 uGroundNear;
uniform vec3 uGroundFar;
uniform float uEyeAboveGroundM;
uniform float uFallbackDeg;
uniform int uHasTerrain;

uniform int uHasMw;
uniform sampler2D uMw;
uniform vec3 uEqj0;
uniform vec3 uEqj1;
uniform vec3 uEqj2;
uniform float uMwGain;

uniform sampler2D uGColor;
uniform sampler2D uGPos;
uniform sampler2D uGNormal;

uniform int uShadowOn;
uniform float uShadowGain;

/** xyz direction, w tangent of the semidiameter; w <= 0 means the body is not drawn. */
uniform vec4 uSun;
uniform vec4 uMoon;
uniform float uMoonlight;
/** Rows of ENU → selenographic, the sun seen from the moon, and the earthshine weight. */
uniform vec3 uMoonBody0;
uniform vec3 uMoonBody1;
uniform vec3 uMoonBody2;
uniform vec3 uMoonSun;
uniform float uMoonShine;
uniform int uHasMoonMap;
uniform sampler2D uMoonMap;

${SHADOW_GLSL}

out vec4 oColor;

float sstep(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec3 skyAt(float alt) {
  float t = sstep(0.0, 60.0, alt);
  vec3 c = mix(mix(HORIZON_NIGHT, ZENITH_NIGHT, t), mix(HORIZON_DAY, ZENITH_DAY, t), uDay);
  float glow = uDusk * (1.0 - sstep(0.0, 18.0, alt));
  return mix(c, DUSK_GLOW, glow * 0.6);
}

vec3 skyPixel(float alt, vec3 v, float len) {
  vec3 c0 = skyAt(alt);
  if (uHasMw == 0) return c0;
  vec3 d = v / len;
  vec3 q = vec3(dot(uEqj0, d), dot(uEqj1, d), dot(uEqj2, d));
  float fu = 0.5 - atan(q.y, q.x) / (2.0 * PI);
  fu -= floor(fu);
  float fv = (PI * 0.5 - asin(clamp(q.z, -1.0, 1.0))) / PI;
  return c0 + texture(uMw, vec2(fu, fv)).rgb * 255.0 * uMwGain;
}

/** The sun is gone but the sky is not, so a shadowed pixel darkens toward blue rather than to black. */
vec3 shadeShadow(vec3 c, float gain) {
  float t = gain * sstep(0.1, 0.45, dot(c, vec3(0.3, 0.59, 0.11)) / 255.0);
  return c * vec3(1.0 - 0.55 * t, 1.0 - 0.5 * t, 1.0 - 0.36 * t);
}

/** The moon at a pixel of its disc, lit as a Lommel–Seeliger sphere. */
vec3 moonPixel(vec3 v, float sinSemi, vec3 sky) {
  vec3 d = normalize(uMoon.xyz);
  vec3 w = normalize(v);
  vec3 q = (w - d * dot(w, d)) / sinSemi;
  float qq = min(dot(q, q), 1.0);
  vec3 n = q - sqrt(1.0 - qq) * d;
  float albedo = 1.0;
  if (uHasMoonMap == 1) {
    vec3 b = vec3(dot(uMoonBody0, n), dot(uMoonBody1, n), dot(uMoonBody2, n));
    vec2 uv = vec2(0.5 + atan(b.y, b.x) / (2.0 * PI), 0.5 - asin(clamp(b.z, -1.0, 1.0)) / PI);
    albedo = dot(texture(uMoonMap, uv).rgb, vec3(0.3, 0.59, 0.11)) / MOON_MEAN_ALBEDO;
  }
  float mu0 = dot(n, uMoonSun);
  float mu = max(dot(n, -d), 0.0);
  float ls = mu0 > 0.0 ? clamp(2.0 * mu0 / (mu0 + mu + 1e-4), 0.0, 1.25) : 0.0;
  // The unlit side hides the stars but not the air in front of it.
  vec3 dark = sky + albedo * EARTHSHINE_RGB * uMoonShine;
  return mix(dark, MOON_LIT_RGB * albedo * ls, sstep(-0.01, 0.03, mu0));
}

/** Offset of this pixel from a body's centre, in tangent units of the camera's own frame. */
vec2 discOffset(vec3 v, vec3 b) {
  float dv = dot(v, uFwd);
  float db = dot(b, uFwd);
  if (dv <= 0.0 || db <= 0.0) return vec2(1e6);
  return vec2(dot(v, uRight) / dv - dot(b, uRight) / db, dot(v, uUp) / dv - dot(b, uUp) / db);
}

void main() {
  vec2 fc = gl_FragCoord.xy - uOrigin;
  float xMm = (fc.x / uRes.x - 0.5) * uWmm;
  float yMm = (fc.y / uRes.y - 0.5) * uHmm;
  vec3 v = uFwd + (xMm / uFocal) * uRight + (yMm / uFocal) * uUp;
  float len = length(v);
  float alt = asin(v.z / len) / D2R;

  ivec2 bi = ivec2(fc);
  vec4 gp = texelFetch(uGPos, bi, 0);
  vec3 c;
  bool onSky;
  if (gp.w > 0.5) {
    onSky = false;
    c = texelFetch(uGColor, bi, 0).rgb * 255.0;
    vec4 gn = texelFetch(uGNormal, bi, 0);
    vec3 n = normalize(gn.xyz * 2.0 - 1.0);
    if (uShadowOn == 1) {
      float sh = sunShadow(gp.xyz, n, dot(gp.xyz, uFwd), gn.w < 0.75);
      // Night ground is too dark to shade, so moonlight shows as the lit side brightening.
      if (uMoonlight > 0.0) c = mix(c, c * 1.8 + MOONLIGHT_RGB, uMoonlight * uShadowGain * (1.0 - sh));
      else c = mix(c, shadeShadow(c, uShadowGain), sh);
    }
  } else if (uHasTerrain == 0 && alt <= uFallbackDeg) {
    // Cold start: a flat ground plane until the clipmap arrives.
    onSky = false;
    float d = clamp(-uEyeAboveGroundM / tan(min(-0.001, alt * D2R)), 20.0, 50000.0);
    c = mix(uGroundNear, uGroundFar, 1.0 - exp(-d / HAZE_M)) * 0.9;
  } else {
    onSky = true;
    c = skyPixel(alt, v, len);
  }

  // A body behind geometry stays faintly visible, the way the overlay used to ghost it.
  float ghost = onSky ? 1.0 : 0.35;
  if (uSun.w > 0.0) {
    vec2 o = discOffset(v, uSun.xyz) / uSun.w;
    float r = length(o);
    if (r < 4.0) c = mix(c, c + SUN_GLOW_RGB * 0.55 * (1.0 - clamp((r - 0.5) / 3.5, 0.0, 1.0)), ghost);
    if (r <= 1.0) c = mix(c, SUN_RGB, ghost);
  }
  // Moon after sun, so an eclipse shows the covered disc.
  if (uMoon.w > 0.0) {
    vec2 o = discOffset(v, uMoon.xyz) / uMoon.w;
    float rr = dot(o, o);
    if (rr <= 1.0) c = mix(c, moonPixel(v, uMoon.w / sqrt(1.0 + uMoon.w * uMoon.w), skyAt(alt)), ghost);
  }
  oColor = vec4(c / 255.0, 1.0);
}
`;

const UNIFORMS = [
  'uOrigin', 'uRes', 'uFwd', 'uRight', 'uUp', 'uFocal', 'uWmm', 'uHmm',
  'uDay', 'uDusk', 'uGroundNear', 'uGroundFar', 'uEyeAboveGroundM', 'uFallbackDeg', 'uHasTerrain',
  'uHasMw', 'uMw', 'uEqj0', 'uEqj1', 'uEqj2', 'uMwGain',
  'uGColor', 'uGPos', 'uGNormal',
  'uShadowOn', 'uShadowGain', 'uSun', 'uMoon', 'uMoonlight',
  'uMoonBody0', 'uMoonBody1', 'uMoonBody2', 'uMoonSun', 'uMoonShine', 'uHasMoonMap', 'uMoonMap',
  ...SHADOW_UNIFORMS
];

/** Shadows would be meaningless once the light is this far under the horizon. */
const LIGHT_MIN_ALT_DEG = -0.9;

export class SceneGl {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly uni: Record<string, WebGLUniformLocation | null>;
  private readonly prismGl: PrismGl;
  private readonly terrainGl: TerrainGl;
  private readonly shadowGl: ShadowGl;
  private readonly dummy2d: WebGLTexture;
  private readonly timer: TimerExt | null;
  private query: WebGLQuery | null = null;
  private lastGpuMs = -1;
  private mw: { key: SceneGlTexture; tex: WebGLTexture } | null = null;
  private moonMap: { key: SceneGlTexture; tex: WebGLTexture } | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private gColor: WebGLTexture | null = null;
  private gPos: WebGLTexture | null = null;
  private gNormal: WebGLTexture | null = null;
  private depthRb: WebGLRenderbuffer | null = null;
  private rw = 0;
  private rh = 0;
  private readonly cascadeMats = new Float32Array(16 * CASCADE_COUNT);
  private readonly cascadeInfo = new Float32Array(4 * CASCADE_COUNT);

  /** Throws where the picture cannot be drawn at all; there is no CPU fallback behind it. */
  static create(canvas: HTMLCanvasElement): SceneGl {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('The viewfinder needs WebGL2, which this browser does not provide.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('The viewfinder needs float render targets (EXT_color_buffer_float), which this browser does not provide.');
    return new SceneGl(gl);
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = linkProgram(gl, VERT_SRC, FRAG_SRC, 'sceneGl');
    this.uni = uniforms(gl, this.prog, UNIFORMS);
    this.prismGl = new PrismGl(gl);
    this.terrainGl = new TerrainGl(gl);
    this.shadowGl = new ShadowGl(gl);
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    this.dummy2d = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.dummy2d);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  /** Sizes the drawing buffer; the picture itself is drawn into `viewport` inside it. */
  resize(w: number, h: number): void {
    const c = this.gl.canvas as HTMLCanvasElement;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
  }

  render(input: SceneGlInput, vx: number, vy: number, vw: number, vh: number): SceneGlStats {
    const gl = this.gl;
    if (this.timer) {
      this.query = gl.createQuery();
      gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.query!);
    }
    this.resizeTargets(vw, vh);
    this.terrainGl.sync(input.terrain);

    const terrain = this.geometryPass(input, vw, vh);
    const shadow = this.shadowPass(input);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(vx, vy, vw, vh);
    this.composite(input, shadow.cascades, vx, vy, vw, vh);

    if (this.timer && this.query) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      const q = this.query;
      this.query = null;
      const poll = () => {
        if (gl.isContextLost()) return;
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) this.lastGpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        else setTimeout(poll, 1);
      };
      poll();
    }
    return {
      prism: this.lastPrism,
      terrain,
      cascades: shadow.cascades.length,
      shadowTriangles: shadow.triangles,
      shadowPrismTriangles: shadow.prismTriangles,
      shadowModelTriangles: shadow.modelTriangles,
      cascadeInfo: shadow.cascades.map((c) => ({ farM: c.farM, texelXM: c.texelXM, texelYM: c.texelYM })),
      viewRangeM: shadow.scene?.viewNearM !== undefined && shadow.scene.viewFarM !== undefined ? [shadow.scene.viewNearM, shadow.scene.viewFarM] : null,
      gpuMs: this.lastGpuMs
    };
  }

  dispose(): void {
    const gl = this.gl;
    this.prismGl.dispose();
    this.terrainGl.dispose();
    this.shadowGl.dispose();
    this.dropTargets();
    if (this.mw) gl.deleteTexture(this.mw.tex);
    if (this.moonMap) gl.deleteTexture(this.moonMap.tex);
    gl.deleteTexture(this.dummy2d);
    gl.deleteProgram(this.prog);
  }

  private lastPrism: PrismGlStats | null = null;

  private geometryPass(input: SceneGlInput, vw: number, vh: number): TerrainGlStats | null {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.viewport(0, 0, vw, vh);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.GREATER);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [0]);
    const lightAz = input.prism?.shading.lightAzDeg ?? input.lightAzDeg;
    const terrain = this.terrainGl.ready ? this.terrainGl.render(input.cam, input.basis, input.groundNear, input.groundFar, lightAz) : null;
    this.lastPrism = input.prism ? this.prismGl.render(input.cam, input.basis, input.prism.tiles, input.prism.shading, vw, vh, input.prism.models) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return terrain;
  }

  private shadowPass(input: SceneGlInput): { cascades: Cascade[]; triangles: number; prismTriangles: number; modelTriangles: number; scene: SceneBounds | null } {
    const none = { cascades: [], triangles: 0, prismTriangles: 0, modelTriangles: 0, scene: null };
    if (input.lightAltDeg < LIGHT_MIN_ALT_DEG || input.shadowGain <= 0) return none;
    if (!this.terrainGl.ready && !input.prism) return none;
    const gl = this.gl;
    const light = lightBasis(input.lightAzDeg, input.lightAltDeg, input.basis.forward);
    // Towers reach hundreds of metres above the terrain band, so the prisms must widen the fit too.
    const terrainScene = this.terrainGl.ready ? this.terrainGl.bounds(input.cam, input.basis) : null;
    const prismScene = input.prism ? this.prismGl.bounds(input.cam, input.basis, input.prism.tiles, input.prism.models) : null;
    const scene = mergeScene(terrainScene, prismScene) ?? { halfM: 20000, minU: -1000, maxU: 1000 };
    const cascades = fitCascades(input.cam, input.basis, light, scene, this.shadowGl.res);
    let triangles = 0;
    let prismTriangles = 0;
    let modelTriangles = 0;
    this.shadowGl.render(cascades, light, (c) => {
      triangles += this.terrainGl.renderDepth(c, light);
      if (!input.prism) return;
      const d = this.prismGl.renderDepth(c, light, input.prism.tiles, input.prism.models);
      prismTriangles += d.triangles;
      modelTriangles += d.modelTriangles;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { cascades, triangles: triangles + prismTriangles + modelTriangles, prismTriangles, modelTriangles, scene };
  }

  private composite(input: SceneGlInput, cascades: readonly Cascade[], vx: number, vy: number, vw: number, vh: number): void {
    const gl = this.gl;
    gl.useProgram(this.prog);
    const u = this.uni;
    gl.uniform2f(u.uOrigin, vx, vy);
    gl.uniform2f(u.uRes, vw, vh);
    const { forward: F, right: R, up: U } = input.basis;
    gl.uniform3f(u.uFwd, F.x, F.y, F.z);
    gl.uniform3f(u.uRight, R.x, R.y, R.z);
    gl.uniform3f(u.uUp, U.x, U.y, U.z);
    gl.uniform1f(u.uFocal, input.cam.focalMm);
    gl.uniform1f(u.uWmm, input.cam.frameWmm);
    gl.uniform1f(u.uHmm, input.cam.frameHmm);
    gl.uniform1f(u.uDay, input.day);
    gl.uniform1f(u.uDusk, input.dusk);
    gl.uniform3f(u.uGroundNear, input.groundNear[0], input.groundNear[1], input.groundNear[2]);
    gl.uniform3f(u.uGroundFar, input.groundFar[0], input.groundFar[1], input.groundFar[2]);
    gl.uniform1f(u.uEyeAboveGroundM, input.eyeAboveGroundM);
    gl.uniform1f(u.uFallbackDeg, input.fallbackDeg);
    gl.uniform1i(u.uHasTerrain, this.terrainGl.ready ? 1 : 0);

    const mw = input.milkyWay && input.eqj && input.mwGain > 0 ? this.uploadMilkyWay(input.milkyWay) : null;
    gl.uniform1i(u.uHasMw, mw ? 1 : 0);
    if (mw && input.eqj) {
      const e = input.eqj;
      gl.uniform3f(u.uEqj0, e[0], e[1], e[2]);
      gl.uniform3f(u.uEqj1, e[3], e[4], e[5]);
      gl.uniform3f(u.uEqj2, e[6], e[7], e[8]);
      gl.uniform1f(u.uMwGain, input.mwGain);
    }
    this.bind(0, u.uMw, mw ?? this.dummy2d);
    this.bind(1, u.uGColor, this.gColor ?? this.dummy2d);
    this.bind(2, u.uGPos, this.gPos ?? this.dummy2d);
    this.bind(3, u.uGNormal, this.gNormal ?? this.dummy2d);

    gl.uniform1i(u.uShadowOn, cascades.length ? 1 : 0);
    gl.uniform1f(u.uShadowGain, input.shadowGain);
    gl.uniform1f(u.uMoonlight, input.moonlight);
    if (cascades.length) {
      for (const [i, c] of cascades.entries()) {
        this.cascadeMats.set(c.matrix, i * 16);
        this.cascadeInfo.set([c.texelXM, c.depthRangeM, c.farM, c.texelYM], i * 4);
      }
      gl.uniformMatrix4fv(u.uCascade, false, this.cascadeMats);
      gl.uniform4fv(u.uCascadeInfo, this.cascadeInfo);
      gl.uniform1i(u.uCascadeCount, cascades.length);
      const s = cameraBasis({ azimuthDeg: input.lightAzDeg, elevationDeg: input.lightAltDeg }).forward;
      gl.uniform3f(u.uSunDir, s.x, s.y, s.z);
    }
    this.shadowGl.bind(4, 5);
    gl.uniform1i(u.uShadow, 4);
    gl.uniform1i(u.uShadowRaw, 5);

    this.disc(u.uSun, input.sunDisc);
    this.disc(u.uMoon, input.moonDisc);
    const m = input.moonDisc?.moon;
    if (m) {
      const e = m.enuToBody;
      gl.uniform3f(u.uMoonBody0, e[0], e[1], e[2]);
      gl.uniform3f(u.uMoonBody1, e[3], e[4], e[5]);
      gl.uniform3f(u.uMoonBody2, e[6], e[7], e[8]);
      gl.uniform3f(u.uMoonSun, m.sunDir[0], m.sunDir[1], m.sunDir[2]);
      gl.uniform1f(u.uMoonShine, m.earthshine);
    }
    const moonMap = m?.map ? this.uploadMoonMap(m.map) : null;
    gl.uniform1i(u.uHasMoonMap, moonMap ? 1 : 0);
    this.bind(6, u.uMoonMap, moonMap ?? this.dummy2d);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.shadowGl.unbind(4, 5);
  }

  private disc(loc: WebGLUniformLocation | null, d: BodyDisc | null): void {
    if (!d) {
      this.gl.uniform4f(loc, 0, 0, 1, -1);
      return;
    }
    this.gl.uniform4f(loc, d.dir[0], d.dir[1], d.dir[2], Math.tan(Math.max(d.semiDeg, 0.02) * (Math.PI / 180)));
  }

  private bind(unit: number, loc: WebGLUniformLocation | null, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  private resizeTargets(rw: number, rh: number): void {
    if (rw === this.rw && rh === this.rh) return;
    const gl = this.gl;
    this.dropTargets();
    this.rw = rw;
    this.rh = rh;
    const make = (internal: number) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, rw, rh);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.gColor = make(gl.RGBA8);
    this.gPos = make(gl.RGBA32F);
    this.gNormal = make(gl.RGBA8);
    this.depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT32F, rw, rh);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.gColor, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.gPos, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, this.gNormal, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`sceneGl framebuffer incomplete: 0x${st.toString(16)}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private dropTargets(): void {
    const gl = this.gl;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.gColor) gl.deleteTexture(this.gColor);
    if (this.gPos) gl.deleteTexture(this.gPos);
    if (this.gNormal) gl.deleteTexture(this.gNormal);
    if (this.depthRb) gl.deleteRenderbuffer(this.depthRb);
    this.fbo = null;
    this.gColor = null;
    this.gPos = null;
    this.gNormal = null;
    this.depthRb = null;
  }

  private uploadMilkyWay(tex: SceneGlTexture): WebGLTexture {
    if (this.mw?.key === tex) return this.mw.tex;
    const gl = this.gl;
    if (this.mw) gl.deleteTexture(this.mw.tex);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, tex.width, tex.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tex.width, tex.height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(tex.rgba.buffer, tex.rgba.byteOffset, tex.rgba.length));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // The sky wraps in right ascension and stops at the poles, exactly as the CPU sampler does.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.mw = { key: tex, tex: t };
    return t;
  }

  private uploadMoonMap(tex: SceneGlTexture): WebGLTexture {
    if (this.moonMap?.key === tex) return this.moonMap.tex;
    const gl = this.gl;
    if (this.moonMap) gl.deleteTexture(this.moonMap.tex);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, tex.width, tex.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tex.width, tex.height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(tex.rgba.buffer, tex.rgba.byteOffset, tex.rgba.length));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.moonMap = { key: tex, tex: t };
    return t;
  }
}
