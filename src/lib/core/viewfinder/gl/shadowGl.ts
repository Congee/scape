/**
 * The cascaded shadow map itself: one depth-only orthographic pass per cascade into a depth array
 * texture, and the GLSL the composite uses to read it back. The sun is half a degree wide, so the
 * lookup sizes its filter from the blocker distance rather than picking a fixed softness.
 */

import type { CameraBasis } from '@core/optics/projection';
import { CASCADE_COUNT, CASCADE_RES, SUN_ANGULAR, type Cascade } from './shadowFit';

/** Normal offset and depth bias, in shadow texels; both scale with the cascade so neither shows. */
const NORMAL_OFFSET_TEXELS = 1.6;
const CONST_BIAS_TEXELS = 0.6;
const SLOPE_BIAS_TEXELS = 2.4;
const MAX_BIAS_TEXELS = 12.0;
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
const float MAX_FILTER_TEXELS = ${MAX_FILTER_TEXELS.toFixed(5)};
const float SHADOW_RES = ${CASCADE_RES.toFixed(1)};

uniform highp sampler2DArrayShadow uShadow;
uniform highp sampler2DArray uShadowRaw;
uniform mat4 uCascade[CASCADES];
/** Per cascade: texel metres along light right, light-space depth range, axial far edge, texel metres along light up. */
uniform vec4 uCascadeInfo[CASCADES];
uniform int uCascadeCount;
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
float cascadeShadow(int i, vec3 p, vec3 n, float ndl) {
  vec4 info = uCascadeInfo[i];
  float texelX = info.x;
  float rangeM = info.y;
  float texelY = info.w;
  float fineM = min(texelX, texelY);
  // Normal offset need only clear the finer axis; the coarse one is covered by the plane bias.
  vec3 q = p + n * (NORMAL_OFFSET_TEXELS * fineM / max(ndl, 0.15));
  vec3 c = cascadeCoord(i, q);
  if (!insideCascade(c)) return -1.0;
  // The light axes fall out of the cascade matrix, whose scale is two texels over the map side.
  mat4 m = uCascade[i];
  vec3 lr = vec3(m[0][0], m[1][0], m[2][0]) * (0.5 * texelX * SHADOW_RES);
  vec3 lu = vec3(m[0][1], m[1][1], m[2][1]) * (0.5 * texelY * SHADOW_RES);
  // Receiver-plane bias: how far the surface's own depth runs across one texel, taken per axis
  // because a long lens makes the cascade tens of times coarser along the view than across it.
  float slopeM = (abs(dot(n, lr)) * texelX + abs(dot(n, lu)) * texelY) / max(ndl, 0.05);
  float biasM = min(CONST_BIAS_TEXELS * fineM + SLOPE_BIAS_TEXELS * slopeM, MAX_BIAS_TEXELS * max(texelX, texelY));
  float ref = c.z + biasM / rangeM;

  // Blocker search: how far upwind the nearest caster is sets how wide the penumbra should be.
  vec2 texel = vec2(1.0 / SHADOW_RES);
  vec2 search = 4.0 * texel;
  float sum = 0.0;
  float hits = 0.0;
  for (int k = 0; k < 12; k++) {
    float d = texture(uShadowRaw, vec3(c.xy + POISSON[k] * search, float(i))).r;
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
  for (int k = 0; k < 12; k++) lit += texture(uShadow, vec4(c.xy + POISSON[k] * radius, float(i), ref));
  return 1.0 - lit / 12.0;
}

/** Cascade chosen by axial depth, cross-faded at the seam so no boundary shows. */
float sunShadow(vec3 p, vec3 n, float axialM) {
  float ndl = dot(n, uSunDir);
  if (ndl <= 0.0) return 1.0;
  for (int i = 0; i < CASCADES; i++) {
    if (i >= uCascadeCount) break;
    float far = uCascadeInfo[i].z;
    if (axialM > far && i + 1 < uCascadeCount) continue;
    float s = cascadeShadow(i, p, n, ndl);
    if (s < 0.0) continue;
    float blend = far * 0.12;
    if (i + 1 < uCascadeCount && axialM > far - blend) {
      float t = clamp((axialM - (far - blend)) / blend, 0.0, 1.0);
      float s2 = cascadeShadow(i + 1, p, n, ndl);
      if (s2 >= 0.0) return mix(s, s2, t);
    }
    return s;
  }
  return 0.0;
}
`;

export const SHADOW_UNIFORMS = ['uShadow', 'uShadowRaw', 'uCascade', 'uCascadeInfo', 'uCascadeCount', 'uSunDir'];

export class ShadowGl {
  private readonly gl: WebGL2RenderingContext;
  private readonly tex: WebGLTexture;
  private readonly fbo: WebGLFramebuffer;
  private readonly compare: WebGLSampler;
  private readonly plain: WebGLSampler;
  readonly res: number;

  constructor(gl: WebGL2RenderingContext, res = CASCADE_RES) {
    this.gl = gl;
    this.res = res;
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT32F, res, res, CASCADE_COUNT);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
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

  /** Runs `draw` once per cascade with that cascade's layer bound; reversed-Z, cleared to 0. */
  render(cascades: readonly Cascade[], light: CameraBasis, draw: (c: Cascade, light: CameraBasis) => void): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.res, this.res);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.GREATER);
    gl.colorMask(false, false, false, false);
    for (const [i, c] of cascades.entries()) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.tex, 0, i);
      gl.clearBufferfv(gl.DEPTH, 0, [0]);
      draw(c, light);
    }
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Binds the compared and the raw view of the map to two units. */
  bind(compareUnit: number, rawUnit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + compareUnit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.bindSampler(compareUnit, this.compare);
    gl.activeTexture(gl.TEXTURE0 + rawUnit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.bindSampler(rawUnit, this.plain);
  }

  unbind(compareUnit: number, rawUnit: number): void {
    this.gl.bindSampler(compareUnit, null);
    this.gl.bindSampler(rawUnit, null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteSampler(this.compare);
    gl.deleteSampler(this.plain);
  }
}
