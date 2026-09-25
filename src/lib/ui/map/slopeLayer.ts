import type { CustomLayerInterface, Map as MlMap } from 'maplibre-gl';
import { ASPECT_MIN_SLOPE_DEG, SLOPE_BANDS_DEG } from '@core/terrain/slope';
import { ASPECT_SATURATION, ASPECT_VALUE, hexRgb, SLOPE_COLORS } from './layerRamps';

export const TerrainShade = {
  Slope: 'slope',
  Aspect: 'aspect'
} as const;
export type TerrainShade = (typeof TerrainShade)[keyof typeof TerrainShade];

const EXTENT = 8192;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const BAND_RGBA = SLOPE_COLORS.flatMap((c) => (c === 'transparent' ? [0, 0, 0, 0] : hexRgb(c).concat(1)));

/** MapLibre internals the layer reads; none are in its public typings. */
interface TileId {
  overscaledZ: number;
  canonical: { z: number; x: number; y: number };
}
interface InternalTile {
  dem?: { dim: number; stride: number; getUnpackVector(): number[] } | null;
  demTexture?: { texture: WebGLTexture } | null;
}
interface InternalMap {
  style: { tileManagers: Record<string, { getVisibleCoordinates(): TileId[]; getTile(id: TileId): InternalTile } | undefined> };
  painter: {
    transform: { getProjectionData(p: { overscaledTileID: TileId; aligned: boolean; applyGlobeMatrix: boolean; applyTerrainMatrix: boolean }): { mainMatrix: Float32Array } };
    getStencilConfigForOverlapAndUpdateStencilID(ids: TileId[]): [Record<number, unknown>, TileId[]];
    context: { setStencilMode(m: unknown): void };
  };
}

const VERT = `#version 300 es
uniform mat4 u_matrix;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = u_matrix * vec4(a_pos * ${EXTENT}.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform highp sampler2D u_dem;
uniform vec4 u_unpack;
uniform float u_dim;
uniform vec2 u_merc;
uniform float u_cell0;
uniform float u_opacity;
uniform int u_mode;
uniform vec4 u_bands;
uniform vec4 u_colors[5];
in vec2 v_uv;
out vec4 fragColor;

float elev(ivec2 p) {
  vec4 d = texelFetch(u_dem, p + 2, 0) * 255.0;
  d.a = -1.0;
  return dot(d, u_unpack);
}

// Horn's east and north gradients at post p, in elevation per cell.
vec2 horn(ivec2 p) {
  float e0 = elev(p + ivec2(-1, -1)), e1 = elev(p + ivec2(0, -1)), e2 = elev(p + ivec2(1, -1));
  float e3 = elev(p + ivec2(-1, 0)), e5 = elev(p + ivec2(1, 0));
  float e6 = elev(p + ivec2(-1, 1)), e7 = elev(p + ivec2(0, 1)), e8 = elev(p + ivec2(1, 1));
  return vec2((e2 + 2.0 * e5 + e8) - (e0 + 2.0 * e3 + e6), (e0 + 2.0 * e1 + e2) - (e6 + 2.0 * e7 + e8)) / 8.0;
}

vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}

void main() {
  vec2 q = v_uv * u_dim - 0.5;
  vec2 f = fract(q);
  ivec2 i0 = clamp(ivec2(floor(q)), ivec2(-1), ivec2(int(u_dim) - 1));
  vec2 g = mix(mix(horn(i0), horn(i0 + ivec2(1, 0)), f.x), mix(horn(i0 + ivec2(0, 1)), horn(i0 + ivec2(1, 1)), f.x), f.y);
  float m = mix(u_merc.x, u_merc.y, v_uv.y);
  g /= u_cell0 / cosh(m);
  float slope = degrees(atan(length(g)));
  vec4 c;
  if (u_mode == 0) {
    int band = int(slope >= u_bands.x) + int(slope >= u_bands.y) + int(slope >= u_bands.z) + int(slope >= u_bands.w);
    c = u_colors[band];
  } else {
    float az = mod(degrees(atan(-g.x, -g.y)) + 360.0, 360.0);
    c = vec4(hsv(az / 360.0, ${ASPECT_SATURATION}, ${ASPECT_VALUE}), smoothstep(${ASPECT_MIN_SLOPE_DEG - 0.5}, ${ASPECT_MIN_SLOPE_DEG + 0.5}, slope));
  }
  float a = c.a * u_opacity;
  fragColor = vec4(c.rgb * a, a);
}`;

/** Slope bands or aspect hues from the DEM textures of a raster-dem source a color-relief layer keeps uploaded. */
export class SlopeLayer implements CustomLayerInterface {
  readonly type = 'custom';
  readonly renderingMode = '2d';
  private map: MlMap | null = null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buf: WebGLBuffer | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  opacity = 1;

  constructor(
    readonly id: string,
    private readonly source: string,
    private readonly mode: TerrainShade
  ) {}

  onAdd(map: MlMap, gl: WebGL2RenderingContext) {
    this.map = map;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`[scape] ${this.id} shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`[scape] ${this.id} link: ${gl.getProgramInfoLog(p)}`);
    this.prog = p;
    for (const u of ['u_matrix', 'u_dem', 'u_unpack', 'u_dim', 'u_merc', 'u_cell0', 'u_opacity', 'u_mode', 'u_bands', 'u_colors']) this.loc[u] = gl.getUniformLocation(p, u);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    gl.deleteProgram(this.prog);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.buf);
    this.map = null;
  }

  render(gl: WebGL2RenderingContext) {
    const m = this.map as unknown as InternalMap | null;
    const tm = m?.style.tileManagers[this.source];
    if (!m || !tm || this.opacity <= 0) return;
    const ids = tm.getVisibleCoordinates();
    if (!ids.length) return;
    const [stencil, coords] = m.painter.getStencilConfigForOverlapAndUpdateStencilID(ids);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.loc.u_dem, 0);
    gl.uniform1f(this.loc.u_opacity, this.opacity);
    gl.uniform1i(this.loc.u_mode, this.mode === TerrainShade.Slope ? 0 : 1);
    gl.uniform4fv(this.loc.u_bands, [...SLOPE_BANDS_DEG]);
    gl.uniform4fv(this.loc.u_colors, BAND_RGBA);
    for (const id of coords) {
      const tile = tm.getTile(id);
      const dem = tile?.dem;
      if (!dem || !tile.demTexture) continue;
      m.painter.context.setStencilMode(stencil[id.overscaledZ]);
      const { z, y } = id.canonical;
      const n = 2 ** z;
      gl.uniformMatrix4fv(this.loc.u_matrix, false, m.painter.transform.getProjectionData({ overscaledTileID: id, aligned: false, applyGlobeMatrix: false, applyTerrainMatrix: false }).mainMatrix);
      gl.uniform4fv(this.loc.u_unpack, dem.getUnpackVector());
      gl.uniform1f(this.loc.u_dim, dem.dim);
      gl.uniform2f(this.loc.u_merc, Math.PI * (1 - (2 * y) / n), Math.PI * (1 - (2 * (y + 1)) / n));
      gl.uniform1f(this.loc.u_cell0, EARTH_CIRCUMFERENCE_M / (dem.dim * n));
      gl.bindTexture(gl.TEXTURE_2D, tile.demTexture.texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindVertexArray(null);
  }
}
