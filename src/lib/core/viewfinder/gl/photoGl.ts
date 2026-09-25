/**
 * The reference photo, blended over the composite and under the sky marks, which a DOM layer
 * between the two canvases could not be.
 */

import type { PhotoBox } from '@core/photo/fit';
import { linkProgram, uniforms } from './prismGl';

export interface PhotoLayer {
  image: ImageBitmap;
  /** CSS px of a canvas `dpr` times smaller than the drawing buffer. */
  box: PhotoBox;
  dpr: number;
  opacity: number;
}

const VERT_SRC = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D uPhoto;
uniform float uDpr;
uniform float uCanvasH;
uniform vec2 uCentre;
uniform vec2 uSize;
uniform vec2 uRot;
uniform float uOpacity;
out vec4 fragColor;

void main() {
  vec2 css = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y) / uDpr - uCentre;
  // CSS rotate() turns clockwise on screen; undo it.
  vec2 l = vec2(uRot.x * css.x + uRot.y * css.y, -uRot.y * css.x + uRot.x * css.y);
  vec2 edge = (uSize * 0.5 - abs(l)) * uDpr + 0.5;
  float cov = clamp(edge.x, 0.0, 1.0) * clamp(edge.y, 0.0, 1.0);
  if (cov <= 0.0) discard;
  vec4 c = texture(uPhoto, l / uSize + 0.5);
  float a = c.a * uOpacity * cov;
  fragColor = vec4(c.rgb * a, a);
}
`;

const UNIFORMS = ['uPhoto', 'uDpr', 'uCanvasH', 'uCentre', 'uSize', 'uRot', 'uOpacity'] as const;

export class PhotoGl {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly uni: Record<string, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private tex: { key: ImageBitmap; tex: WebGLTexture } | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = linkProgram(gl, VERT_SRC, FRAG_SRC, 'photoGl');
    this.uni = uniforms(gl, this.prog, UNIFORMS);
    this.vao = gl.createVertexArray()!;
  }

  /** Blends the photo into the current viewport, which clips it to the frame. */
  render(layer: PhotoLayer | null): void {
    if (!layer) return this.drop();
    const gl = this.gl;
    const { box } = layer;
    gl.useProgram(this.prog);
    const u = this.uni;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.upload(layer.image));
    gl.uniform1i(u.uPhoto, 0);
    gl.uniform1f(u.uDpr, layer.dpr);
    gl.uniform1f(u.uCanvasH, gl.canvas.height);
    gl.uniform2f(u.uCentre, box.cx, box.cy);
    gl.uniform2f(u.uSize, box.w, box.h);
    const r = (box.rotDeg * Math.PI) / 180;
    gl.uniform2f(u.uRot, Math.cos(r), Math.sin(r));
    gl.uniform1f(u.uOpacity, layer.opacity);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  private upload(image: ImageBitmap): WebGLTexture {
    if (this.tex?.key === image) return this.tex.tex;
    this.drop();
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(image.width, image.height))) + 1, gl.RGBA8, image.width, image.height);
    // Straight alpha, top row first; the shader premultiplies.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
    // Mipmapped: a wide lens shrinks a camera-sized photo many times over.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex = { key: image, tex: t };
    return t;
  }

  private drop(): void {
    if (!this.tex) return;
    this.gl.deleteTexture(this.tex.tex);
    this.tex = null;
  }

  dispose(): void {
    this.drop();
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.prog);
  }
}
