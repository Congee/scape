/**
 * The skyglow integral on the GPU: VIIRS counts → a mean pyramid → one fragment per sector × ring cell sampling
 * the kernel at the pyramid level matching its sample spacing. Needs WebGL2 with float render targets; no CPU path.
 */

import { emptyBins, KM_PER_DEG_LAT, KM_PER_DEG_LON, RINGS, RINGS_KM, SECTOR_DEG, SECTORS, SOFTEN_KM, type GlowBins } from '@core/sky/skyglow';
import { VIIRS_COLS, VIIRS_PX_PER_DEG, VIIRS_SCALE, type ViirsWindow } from '@core/sky/viirs';

const AZ_SAMPLES = 32;
const RADIAL_SAMPLES = 64;
const LEVELS = 8;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Radiance density per local-plane km², so every level's mean integrates like level 0.
const DENSITY = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D uCounts;
uniform float uRow0;
uniform float uCosLat0;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float lat = radians(90.0 - (uRow0 + float(p.y) + 0.5) / ${VIIRS_PX_PER_DEG.toFixed(1)});
  o = vec4(float(texelFetch(uCounts, p, 0).r) * ${VIIRS_SCALE.toFixed(4)} * cos(lat) / uCosLat0, 0.0, 0.0, 1.0);
}`;

const REDUCE = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
out vec4 o;
float at(ivec2 p, ivec2 n) { return all(lessThan(p, n)) ? texelFetch(uSrc, p, 0).r : 0.0; }
void main() {
  ivec2 n = textureSize(uSrc, 0);
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  o = vec4(0.25 * (at(p, n) + at(p + ivec2(1, 0), n) + at(p + ivec2(0, 1), n) + at(p + ivec2(1, 1), n)), 0.0, 0.0, 1.0);
}`;

const INTEGRATE = `#version 300 es
precision highp float;
uniform sampler2D uLevel[${LEVELS}];
uniform vec2 uObs;
uniform vec2 uPxKm;
uniform float uLambda;
uniform float uRings[${RINGS + 1}];
uniform int uMaxLevel;
out vec4 o;

float fetchL(int l, ivec2 p) {
  ${Array.from({ length: LEVELS }, (_, l) => `if (l == ${l}) { ivec2 n = textureSize(uLevel[${l}], 0); return all(greaterThanEqual(p, ivec2(0))) && all(lessThan(p, n)) ? texelFetch(uLevel[${l}], p, 0).r : 0.0; }`).join('\n\t')}
  return 0.0;
}

float bilinear(int l, vec2 px) {
  vec2 q = px / exp2(float(l)) - 0.5;
  vec2 f = fract(q);
  ivec2 i = ivec2(floor(q));
  return mix(mix(fetchL(l, i), fetchL(l, i + ivec2(1, 0)), f.x), mix(fetchL(l, i + ivec2(0, 1)), fetchL(l, i + ivec2(1, 1)), f.x), f.y);
}

void main() {
  int s = int(gl_FragCoord.x);
  int k = int(gl_FragCoord.y);
  float d0 = uRings[k];
  float d1 = uRings[k + 1];
  float dd = (d1 - d0) / ${RADIAL_SAMPLES.toFixed(1)};
  float da = radians(${SECTOR_DEG.toFixed(6)}) / ${AZ_SAMPLES.toFixed(1)};
  float px0 = sqrt(uPxKm.x * uPxKm.y);
  float w = 0.0;
  float wd = 0.0;
  for (int j = 0; j < ${RADIAL_SAMPLES}; j++) {
    float d = d0 + (float(j) + 0.5) * dd;
    float ker = pow(d * d + ${(SOFTEN_KM * SOFTEN_KM).toFixed(4)}, -1.25) * exp(-d / uLambda);
    int l = clamp(int(floor(log2(max(d * da, dd) / px0))), 0, uMaxLevel);
    float sum = 0.0;
    for (int i = 0; i < ${AZ_SAMPLES}; i++) {
      float az = radians(float(s) * ${SECTOR_DEG.toFixed(6)}) + (float(i) + 0.5) * da;
      vec2 p = uObs + vec2(sin(az), -cos(az)) * d / uPxKm;
      sum += bilinear(l, p);
    }
    float c = sum * d * dd * da * ker;
    w += c;
    wd += c * d;
  }
  o = vec4(w, wd, 0.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, frag: string): WebGLProgram {
  const prog = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VERT],
    [gl.FRAGMENT_SHADER, frag]
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`skyglow shader: ${gl.getShaderInfoLog(sh)}`);
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`skyglow program: ${gl.getProgramInfoLog(prog)}`);
  return prog;
}

interface Level {
  tex: WebGLTexture;
  w: number;
  h: number;
}

interface Loaded {
  win: ViirsWindow;
  lat0: number;
  levels: Level[];
}

/** Owns one WebGL2 context and the pyramid of the last window. */
export class SkyglowGl {
  private gl: WebGL2RenderingContext;
  private density: WebGLProgram;
  private reduce: WebGLProgram;
  private integrate: WebGLProgram;
  private fbo: WebGLFramebuffer;
  private out: WebGLTexture;
  private loaded: Loaded | null = null;

  constructor() {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2', { antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('Skyglow needs WebGL2.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Skyglow needs EXT_color_buffer_float.');
    this.gl = gl;
    this.density = compile(gl, DENSITY);
    this.reduce = compile(gl, REDUCE);
    this.integrate = compile(gl, INTEGRATE);
    this.fbo = gl.createFramebuffer();
    this.out = this.texture(gl.RGBA32F, SECTORS, RINGS);
  }

  get lost(): boolean {
    return this.gl.isContextLost();
  }

  private texture(format: number, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    return t;
  }

  private draw(target: WebGLTexture, w: number, h: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Skyglow cannot render to a float target.');
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Uploads a window and builds its pyramid; `lat0` fixes the local plane the kernel is measured in. */
  load(win: ViirsWindow, lat0: number): void {
    const gl = this.gl;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (win.cols > max || win.rows > max) throw new Error(`VIIRS window ${win.cols}×${win.rows} exceeds this GPU's ${max}px textures.`);
    this.release();
    const counts = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, counts);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, win.cols, win.rows);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, win.cols, win.rows, gl.RED_INTEGER, gl.UNSIGNED_SHORT, win.data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    const levels: Level[] = [{ tex: this.texture(gl.R32F, win.cols, win.rows), w: win.cols, h: win.rows }];
    gl.useProgram(this.density);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, counts);
    gl.uniform1i(gl.getUniformLocation(this.density, 'uCounts'), 0);
    gl.uniform1f(gl.getUniformLocation(this.density, 'uRow0'), win.row0);
    gl.uniform1f(gl.getUniformLocation(this.density, 'uCosLat0'), Math.cos((lat0 * Math.PI) / 180));
    this.draw(levels[0].tex, win.cols, win.rows);
    gl.deleteTexture(counts);
    gl.useProgram(this.reduce);
    gl.uniform1i(gl.getUniformLocation(this.reduce, 'uSrc'), 0);
    while (levels.length < LEVELS) {
      const prev = levels.at(-1)!;
      if (prev.w === 1 && prev.h === 1) break;
      const next = { w: Math.ceil(prev.w / 2), h: Math.ceil(prev.h / 2), tex: this.texture(gl.R32F, Math.ceil(prev.w / 2), Math.ceil(prev.h / 2)) };
      gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      this.draw(next.tex, next.w, next.h);
      levels.push(next);
    }
    this.loaded = { win: { ...win, data: new Uint16Array(0) }, lat0, levels };
  }

  /** The largest window side this GPU can upload. */
  get maxTexture(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  /** The loaded window, without its data; null before the first load. */
  get current(): (Omit<ViirsWindow, 'data'> & { lat0: number }) | null {
    return this.loaded ? { ...this.loaded.win, lat0: this.loaded.lat0 } : null;
  }

  /** Sector × ring sums around an observer inside the loaded window; the GPU twin of referenceBins. */
  run(lat: number, lng: number, lambdaKm: number): GlowBins {
    const L = this.loaded;
    if (!L) throw new Error('Skyglow has no VIIRS window loaded.');
    const gl = this.gl;
    gl.useProgram(this.integrate);
    const units = L.levels.map((lv, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, lv.tex);
      return i;
    });
    // Unused sampler slots still need a valid 2D texture bound.
    while (units.length < LEVELS) units.push(0);
    const u = (n: string) => gl.getUniformLocation(this.integrate, n);
    gl.uniform1iv(u('uLevel'), units);
    gl.uniform1i(u('uMaxLevel'), L.levels.length - 1);
    let x = (lng + 180) * VIIRS_PX_PER_DEG - L.win.col0;
    x -= VIIRS_COLS * Math.round((x - L.win.cols / 2) / VIIRS_COLS);
    const cos = Math.cos((lat * Math.PI) / 180);
    gl.uniform2f(u('uObs'), x, (90 - lat) * VIIRS_PX_PER_DEG - L.win.row0);
    gl.uniform2f(u('uPxKm'), (KM_PER_DEG_LON * cos) / VIIRS_PX_PER_DEG, KM_PER_DEG_LAT / VIIRS_PX_PER_DEG);
    gl.uniform1f(u('uLambda'), lambdaKm);
    gl.uniform1fv(u('uRings'), new Float32Array(RINGS_KM));
    this.draw(this.out, SECTORS, RINGS);
    const px = new Float32Array(SECTORS * RINGS * 4);
    gl.readPixels(0, 0, SECTORS, RINGS, gl.RGBA, gl.FLOAT, px);
    const bins = emptyBins();
    // The pyramid holds density per km² of lat0's plane; this observer's plane is cos(lat)/cos(lat0) as wide.
    const f = Math.cos((L.lat0 * Math.PI) / 180) / cos;
    for (let i = 0; i < SECTORS * RINGS; i++) {
      bins.w[i] = px[i * 4] * f;
      bins.wd[i] = px[i * 4 + 1] * f;
    }
    return bins;
  }

  private release(): void {
    for (const lv of this.loaded?.levels ?? []) this.gl.deleteTexture(lv.tex);
    this.loaded = null;
  }
}
