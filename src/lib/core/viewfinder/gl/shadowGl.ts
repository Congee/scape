/**
 * The cascaded shadow map itself: one depth-only orthographic pass per cascade into a depth array
 * texture, and the GLSL the composite uses to read it back. The sun is half a degree wide, so the
 * lookup sizes its filter from the blocker distance rather than picking a fixed softness.
 */

import type { CameraBasis } from '@core/optics/projection';
import { IdleRelease } from '@core/pool';
import { CASCADE_COUNT, CASCADE_RES, SUN_ANGULAR, type Cascade } from './shadowFit';

/** A map grown past the base side, or an outer set, is let go once no frame has drawn for this long. */
export const SHADOW_IDLE_RELEASE_MS = 5000;

/** Normal offset and depth bias, in shadow texels; both scale with the cascade so neither shows. */
const NORMAL_OFFSET_TEXELS = 1.6;
const CONST_BIAS_TEXELS = 0.6;
const SLOPE_BIAS_TEXELS = 2.4;
const MAX_BIAS_TEXELS = 12.0;
/** Model faces are large flat planes that the low sun grazes, so they take a steeper bias. */
const MODEL_MAX_BIAS_TEXELS = 48.0;
const MODEL_MIN_NDL = 0.02;
/** Widest PCF kernel, texels; past this the far cascade would blur a whole valley. */
const MAX_FILTER_TEXELS = 10.0;

/** Pasted into the composite shader; it owns the uniforms named here. */
export const SHADOW_GLSL = `
const int CASCADES = ${CASCADE_COUNT};
const float SUN_ANGULAR = ${SUN_ANGULAR.toFixed(5)};
const float NORMAL_OFFSET_TEXELS = ${NORMAL_OFFSET_TEXELS.toFixed(5)};
const float CONST_BIAS_TEXELS = ${CONST_BIAS_TEXELS.toFixed(5)};
const float SLOPE_BIAS_TEXELS = ${SLOPE_BIAS_TEXELS.toFixed(5)};
const float MAX_BIAS_TEXELS = ${MAX_BIAS_TEXELS.toFixed(5)};
const float MODEL_MAX_BIAS_TEXELS = ${MODEL_MAX_BIAS_TEXELS.toFixed(5)};
const float MODEL_MIN_NDL = ${MODEL_MIN_NDL.toFixed(5)};
const float MAX_FILTER_TEXELS = ${MAX_FILTER_TEXELS.toFixed(5)};

uniform highp sampler2DArrayShadow uShadow;
uniform highp sampler2DArray uShadowRaw;
/** The outer set, read only where the main cascades miss; empty unless the map side is capped. */
uniform highp sampler2DArrayShadow uShadowOuter;
uniform highp sampler2DArray uShadowOuterRaw;
/** Main cascades first, then the outer set from CASCADES on. */
uniform mat4 uCascade[2 * CASCADES];
/** Per cascade: texel metres along light right, light-space depth range, axial far edge, texel metres along light up. */
uniform vec4 uCascadeInfo[2 * CASCADES];
uniform int uCascadeCount;
uniform int uOuterCount;
/** Map side of the main and the outer set. */
uniform vec2 uShadowRes;
/** Unit vector toward the sun. */
uniform vec3 uSunDir;

const vec2 POISSON[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

vec3 cascadeCoord(int i, vec3 p) {
  vec4 c = uCascade[i] * vec4(p, 1.0);
  return c.xyz * 0.5 + 0.5;
}

bool insideCascade(vec3 c) {
  return all(greaterThanEqual(c.xy, vec2(0.015))) && all(lessThanEqual(c.xy, vec2(0.985))) && c.z > 0.0 && c.z < 1.0;
}

/** 0 lit, 1 fully shadowed, for a receiver at p with outward normal n. */
float cascadeShadow(highp sampler2DArrayShadow cmp, highp sampler2DArray raw, float mapRes, int i, int layer, vec3 p, vec3 n, float ndl, bool model) {
  vec4 info = uCascadeInfo[i];
  float texelX = info.x;
  float rangeM = info.y;
  float texelY = info.w;
  float fineM = min(texelX, texelY);
  // Normal offset need only clear the finer axis; the coarse one is covered by the plane bias.
  vec3 q = p + n * (NORMAL_OFFSET_TEXELS * fineM / max(ndl, model ? 0.05 : 0.15));
  vec3 c = cascadeCoord(i, q);
  if (!insideCascade(c)) return -1.0;
  // The light axes fall out of the cascade matrix, whose scale is two texels over the map side.
  mat4 m = uCascade[i];
  vec3 lr = vec3(m[0][0], m[1][0], m[2][0]) * (0.5 * texelX * mapRes);
  vec3 lu = vec3(m[0][1], m[1][1], m[2][1]) * (0.5 * texelY * mapRes);
  // Receiver-plane bias: how far the surface's own depth runs across one texel, taken per axis
  // because a long lens makes the cascade tens of times coarser along the view than across it.
  float slopeM = (abs(dot(n, lr)) * texelX + abs(dot(n, lu)) * texelY) / max(ndl, model ? MODEL_MIN_NDL : 0.05);
  float biasM = min(CONST_BIAS_TEXELS * fineM + SLOPE_BIAS_TEXELS * slopeM, (model ? MODEL_MAX_BIAS_TEXELS : MAX_BIAS_TEXELS) * max(texelX, texelY));
  float ref = c.z + biasM / rangeM;

  // Blocker search: how far upwind the nearest caster is sets how wide the penumbra should be.
  vec2 texel = vec2(1.0 / mapRes);
  vec2 search = 4.0 * texel;
  float sum = 0.0;
  float hits = 0.0;
  for (int k = 0; k < 12; k++) {
    float d = texture(raw, vec3(c.xy + POISSON[k] * search, float(layer))).r;
    if (d > ref) {
      sum += d;
      hits += 1.0;
    }
  }
  if (hits < 0.5) return 0.0;
  float blockerM = ((sum / hits) - c.z) * rangeM;
  // Kept round in metres rather than in texels, now that the two axes need not match.
  float penumbraM = blockerM * SUN_ANGULAR;
  vec2 radius = clamp(penumbraM / vec2(texelX, texelY), vec2(1.0), vec2(MAX_FILTER_TEXELS)) * texel;

  float lit = 0.0;
  for (int k = 0; k < 12; k++) lit += texture(cmp, vec4(c.xy + POISSON[k] * radius, float(layer), ref));
  return 1.0 - lit / 12.0;
}

/** Cascade of one set chosen by axial depth, cross-faded at the seam so no boundary shows; -1 where none holds p. */
float setShadow(highp sampler2DArrayShadow cmp, highp sampler2DArray raw, float res, int base, int count, vec3 p, vec3 n, float ndl, float axialM, bool model) {
  for (int k = 0; k < CASCADES; k++) {
    if (k >= count) break;
    int i = base + k;
    float far = uCascadeInfo[i].z;
    if (axialM > far && k + 1 < count) continue;
    float s = cascadeShadow(cmp, raw, res, i, k, p, n, ndl, model);
    if (s < 0.0) continue;
    float blend = far * 0.12;
    if (k + 1 < count && axialM > far - blend) {
      float t = clamp((axialM - (far - blend)) / blend, 0.0, 1.0);
      float s2 = cascadeShadow(cmp, raw, res, i + 1, k + 1, p, n, ndl, model);
      if (s2 >= 0.0) return mix(s, s2, t);
    }
    return s;
  }
  return -1.0;
}

float sunShadow(vec3 p, vec3 n, float axialM, bool model) {
  float ndl = dot(n, uSunDir);
  if (ndl <= 0.0) return 1.0;
  // A model face the sun barely grazes gets next to no light, and no bias can hold its acne off.
  float graze = model ? 1.0 - smoothstep(MODEL_MIN_NDL, 3.0 * MODEL_MIN_NDL, ndl) : 0.0;
  float s = setShadow(uShadow, uShadowRaw, uShadowRes.x, 0, uCascadeCount, p, n, ndl, axialM, model);
  if (s < 0.0 && uOuterCount > 0) s = setShadow(uShadowOuter, uShadowOuterRaw, uShadowRes.y, CASCADES, uOuterCount, p, n, ndl, axialM, model);
  return max(graze, s);
}
`;

export const SHADOW_UNIFORMS = ['uShadow', 'uShadowRaw', 'uShadowOuter', 'uShadowOuterRaw', 'uCascade', 'uCascadeInfo', 'uCascadeCount', 'uOuterCount', 'uShadowRes', 'uSunDir'];

/** One depth array texture, CASCADE_COUNT layers of `res` a side. */
interface DepthArray {
  tex: WebGLTexture;
  res: number;
}

export class ShadowGl {
  private readonly gl: WebGL2RenderingContext;
  private readonly fbo: WebGLFramebuffer;
  private readonly compare: WebGLSampler;
  private readonly plain: WebGLSampler;
  /** Bound in place of the outer set when there is none, so its samplers always have a depth texture. */
  private readonly dummy: DepthArray;
  private main: DepthArray | null = null;
  private outer: DepthArray | null = null;
  private readonly idle = new IdleRelease(() => this.trim(), SHADOW_IDLE_RELEASE_MS);
  /** The side the map always keeps; anything past it is held only while frames are drawn. */
  readonly baseRes: number;

  constructor(gl: WebGL2RenderingContext, baseRes = CASCADE_RES) {
    this.gl = gl;
    this.baseRes = baseRes;
    this.dummy = this.alloc(1);
    this.fbo = gl.createFramebuffer()!;
    // Two sampler objects so the same texture can be read both compared and raw in one draw.
    this.compare = gl.createSampler()!;
    gl.samplerParameteri(this.compare, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.samplerParameteri(this.compare, gl.TEXTURE_COMPARE_FUNC, gl.GEQUAL);
    gl.samplerParameteri(this.compare, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.compare, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.compare, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.compare, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.plain = gl.createSampler()!;
    gl.samplerParameteri(this.plain, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.plain, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.plain, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.plain, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Bytes the maps hold now, and at most once idle. */
  get bytes(): number {
    return [this.main, this.outer].reduce((n, a) => n + (a ? a.res * a.res * 4 * CASCADE_COUNT : 0), 0);
  }

  get baseBytes(): number {
    return this.baseRes * this.baseRes * 4 * CASCADE_COUNT;
  }

  /**
   * Runs `draw` once per cascade with that cascade's layer bound; reversed-Z, cleared to 0. The main
   * set goes into a map `res` a side, the outer one, when there is one, into its own of `outerRes`.
   */
  render(cascades: readonly Cascade[], res: number, outer: readonly Cascade[], outerRes: number, light: CameraBasis, draw: (c: Cascade, light: CameraBasis) => void): void {
    const gl = this.gl;
    this.main = this.fit(this.main, res);
    this.outer = outer.length ? this.fit(this.outer, outerRes) : this.drop(this.outer);
    if (res > this.baseRes || this.outer) this.idle.touch();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.GREATER);
    gl.colorMask(false, false, false, false);
    for (const [set, list] of [[this.main, cascades], [this.outer, outer]] as const) {
      if (!set) continue;
      gl.viewport(0, 0, set.res, set.res);
      for (const [i, c] of list.entries()) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, set.tex, 0, i);
        gl.clearBufferfv(gl.DEPTH, 0, [0]);
        draw(c, light);
      }
    }
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Binds the compared and the raw view of the main map, then of the outer one, to four units. */
  bind(compareUnit: number, rawUnit: number, outerCompareUnit: number, outerRawUnit: number): void {
    this.bindArray(compareUnit, rawUnit, this.main ?? this.dummy);
    this.bindArray(outerCompareUnit, outerRawUnit, this.outer ?? this.dummy);
  }

  unbind(...units: number[]): void {
    for (const u of units) this.gl.bindSampler(u, null);
  }

  dispose(): void {
    const gl = this.gl;
    this.idle.cancel();
    for (const a of [this.main, this.outer, this.dummy]) if (a) gl.deleteTexture(a.tex);
    this.main = this.outer = null;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteSampler(this.compare);
    gl.deleteSampler(this.plain);
  }

  /** Back to what an idle viewfinder may hold: the main map at the base side, no outer set. */
  private trim(): void {
    if (this.main && this.main.res > this.baseRes) this.main = this.drop(this.main);
    this.outer = this.drop(this.outer);
  }

  private bindArray(compareUnit: number, rawUnit: number, a: DepthArray): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + compareUnit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, a.tex);
    gl.bindSampler(compareUnit, this.compare);
    gl.activeTexture(gl.TEXTURE0 + rawUnit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, a.tex);
    gl.bindSampler(rawUnit, this.plain);
  }

  private fit(a: DepthArray | null, res: number): DepthArray {
    if (a?.res === res) return a;
    this.drop(a);
    return this.alloc(res);
  }

  private alloc(res: number): DepthArray {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT32F, res, res, CASCADE_COUNT);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return { tex, res };
  }

  private drop(a: DepthArray | null): null {
    if (a) this.gl.deleteTexture(a.tex);
    return null;
  }
}
