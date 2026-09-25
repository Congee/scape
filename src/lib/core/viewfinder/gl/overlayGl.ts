/**
 * Sky marks drawn after the composite (stars, constellation figures, trails, day paths), each
 * fragment tested against the G-buffer so a building hides exactly the part it covers, without a
 * CPU ray per mark. Positions arrive in CSS px of the overlay canvas, as the 2D code placed them.
 */

import { linkProgram, uniforms } from './prismGl';

/** Low two bits of the flags: what the instance covers. */
export const OverlayShape = { Box: 0, Disc: 1, Segment: 2 } as const;
export type OverlayShape = (typeof OverlayShape)[keyof typeof OverlayShape];

export const OverlayFlag = {
  RoundStart: 4,
  RoundEnd: 8,
  /** Hidden whatever the depth says: the terrain skyline is known only on the CPU. */
  Hidden: 16,
  /** Drawn over geometry: only `Hidden` ghosts it. */
  Over: 32
} as const;

/** Floats per instance: segment ends, (half width, flags, ghost alpha, 0), straight RGBA. */
export const OVERLAY_STRIDE = 12;

/** CSS dash of a hidden path, as the canvas drew it: on, off. */
export const PATH_DASH = [3, 4] as const;

type Rgba = readonly [number, number, number, number];

/** Instances for one frame; grows and is reused, so a steady sky allocates nothing. */
export class OverlayBatch {
  data = new Float32Array(OVERLAY_STRIDE * 1024);
  count = 0;

  clear(): void {
    this.count = 0;
  }

  /** Square of half side `r`, as `fillRect` drew the faint stars. */
  box(x: number, y: number, r: number, rgba: Rgba): void {
    this.push(x, y, x, y, r, OverlayShape.Box, 0, rgba);
  }

  disc(x: number, y: number, r: number, rgba: Rgba): void {
    this.push(x, y, x, y, r, OverlayShape.Disc, 0, rgba);
  }

  /** `ghost` 0 drops what is behind geometry; above 0 draws it dashed at that alpha. */
  segment(x0: number, y0: number, x1: number, y1: number, width: number, flags: number, ghost: number, rgba: Rgba): void {
    this.push(x0, y0, x1, y1, width / 2, OverlayShape.Segment | flags, ghost, rgba);
  }

  /** A polyline of flat x, y pairs dashed `on`, `off` from its start, as `setLineDash` strokes it. */
  dashed(pts: readonly number[], width: number, on: number, off: number, flags: number, rgba: Rgba): void {
    let phase = 0;
    for (let i = 2; i + 1 < pts.length; i += 2) {
      const x0 = pts[i - 2];
      const y0 = pts[i - 1];
      const dx = pts[i] - x0;
      const dy = pts[i + 1] - y0;
      const len = Math.hypot(dx, dy);
      let t = 0;
      while (t < len) {
        const inOn = phase < on;
        const step = Math.min(len - t, (inOn ? on : on + off) - phase);
        if (inOn && step > 0) this.segment(x0 + (dx * t) / len, y0 + (dy * t) / len, x0 + (dx * (t + step)) / len, y0 + (dy * (t + step)) / len, width, flags, 0, rgba);
        t += step;
        phase = (phase + step) % (on + off);
      }
    }
  }

  private push(x0: number, y0: number, x1: number, y1: number, hw: number, flags: number, ghost: number, rgba: Rgba): void {
    const o = this.count * OVERLAY_STRIDE;
    if (o + OVERLAY_STRIDE > this.data.length) {
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    const d = this.data;
    d[o] = x0;
    d[o + 1] = y0;
    d[o + 2] = x1;
    d[o + 3] = y1;
    d[o + 4] = hw;
    d[o + 5] = flags;
    d[o + 6] = ghost;
    d[o + 7] = 0;
    d[o + 8] = rgba[0];
    d[o + 9] = rgba[1];
    d[o + 10] = rgba[2];
    d[o + 11] = rgba[3];
    this.count++;
  }
}

/** `#rrggbb` as 0..1 channels with the given alpha. */
export function hexRgba(hex: string, alpha: number): Rgba {
  const v = Number.parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, alpha];
}

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSeg;
layout(location = 1) in vec4 aShape;
layout(location = 2) in vec4 aColor;
uniform float uDpr;
uniform float uCanvasH;
uniform vec2 uOrigin;
uniform vec2 uRes;
flat out vec4 vSeg;
flat out vec4 vShape;
flat out vec4 vColor;
flat out vec2 vDir;

void main() {
  vec2 p0 = vec2(aSeg.x * uDpr, uCanvasH - aSeg.y * uDpr);
  vec2 p1 = vec2(aSeg.z * uDpr, uCanvasH - aSeg.w * uDpr);
  float hw = aShape.x * uDpr;
  vec2 d = p1 - p0;
  float len = length(d);
  d = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  // Two triangles over the shape plus a pixel of antialiasing.
  int k = gl_VertexID;
  float along = (k == 1 || k == 2 || k == 4) ? 1.0 : 0.0;
  float side = (k == 2 || k == 4 || k == 5) ? 1.0 : -1.0;
  float pad = hw + 1.0;
  vec2 px = mix(p0 - d * pad, p1 + d * pad, along) + n * side * pad;
  vSeg = vec4(p0, p1);
  vShape = vec4(hw, aShape.yzw);
  vColor = aColor;
  vDir = d;
  gl_Position = vec4((px - uOrigin) / uRes * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uGPos;
uniform vec2 uOrigin;
uniform float uDpr;
flat in vec4 vSeg;
flat in vec4 vShape;
flat in vec4 vColor;
flat in vec2 vDir;
out vec4 fragColor;

// Overlap of [c - h, c + h] with the pixel around f: box-filtered coverage along one axis.
float span(float f, float c, float h) {
  return clamp(min(c + h, f + 0.5) - max(c - h, f - 0.5), 0.0, 1.0);
}

void main() {
  vec2 f = gl_FragCoord.xy;
  vec2 p0 = vSeg.xy;
  vec2 p1 = vSeg.zw;
  float hw = vShape.x;
  int flags = int(vShape.y + 0.5);
  int shape = flags & 3;
  float t = 0.0;
  float cov;
  if (shape == ${OverlayShape.Box}) cov = span(f.x, p0.x, hw) * span(f.y, p0.y, hw);
  else if (shape == ${OverlayShape.Disc}) cov = clamp(hw + 0.5 - length(f - p0), 0.0, 1.0);
  else {
    vec2 n = vec2(-vDir.y, vDir.x);
    float len = length(p1 - p0);
    t = dot(f - p0, vDir);
    float across = span(dot(f - p0, n), 0.0, hw);
    if (t < 0.0 && (flags & ${OverlayFlag.RoundStart}) != 0) cov = clamp(hw + 0.5 - length(f - p0), 0.0, 1.0);
    else if (t > len && (flags & ${OverlayFlag.RoundEnd}) != 0) cov = clamp(hw + 0.5 - length(f - p1), 0.0, 1.0);
    else cov = across * span(t, len * 0.5, len * 0.5);
  }
  if (cov <= 0.0) discard;
  float a = vColor.a;
  bool behind = (flags & ${OverlayFlag.Hidden}) != 0 || ((flags & ${OverlayFlag.Over}) == 0 && texelFetch(uGPos, ivec2(f - uOrigin), 0).w > 0.5);
  if (behind) {
    float ghost = vShape.z;
    if (ghost <= 0.0 || mod(t / uDpr, ${(PATH_DASH[0] + PATH_DASH[1]).toFixed(1)}) >= ${PATH_DASH[0].toFixed(1)}) discard;
    a = ghost;
  }
  a *= cov;
  fragColor = vec4(vColor.rgb * a, a);
}
`;

const UNIFORMS = ['uDpr', 'uCanvasH', 'uOrigin', 'uRes', 'uGPos'] as const;

export class OverlayGl {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly uni: Record<string, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buf: WebGLBuffer;
  private cap = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = linkProgram(gl, VERT_SRC, FRAG_SRC, 'overlayGl');
    this.uni = uniforms(gl, this.prog, UNIFORMS);
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, OVERLAY_STRIDE * 4, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
  }

  /** Blends the batch over the composite already in the viewport; `gPos` says where geometry is. */
  render(batch: OverlayBatch, gPos: WebGLTexture, dpr: number, vx: number, vy: number, vw: number, vh: number): void {
    if (batch.count === 0) return;
    const gl = this.gl;
    const n = batch.count * OVERLAY_STRIDE;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (n > this.cap) {
      this.cap = batch.data.length;
      gl.bufferData(gl.ARRAY_BUFFER, this.cap * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, n);
    gl.useProgram(this.prog);
    const u = this.uni;
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uCanvasH, gl.canvas.height);
    gl.uniform2f(u.uOrigin, vx, vy);
    gl.uniform2f(u.uRes, vw, vh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gPos);
    gl.uniform1i(u.uGPos, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.buf);
    gl.deleteProgram(this.prog);
  }
}
