/** The DEM clipmap on the GPU: the same G-buffer and the same clip matrix the prisms use. */

import { HAZE_M, ROOF_SHADE, sphereVisible } from '@core/geo/prismRaster';
import type { Camera, CameraBasis } from '@core/optics/projection';
import { IdleRelease, poolSize } from '@core/pool';
import type { MeshLevel } from '@core/terrain/mesh';
import { linkProgram, prismClipMatrix, uniforms } from './prismGl';
import { axialFar, axialNear, boxCastsInto, coneDepthRange, type Cascade, type SceneBounds } from './shadowFit';

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
uniform mat4 uProj;
out vec3 vPos;
out vec3 vNrm;
void main() {
  vPos = aPos;
  vNrm = aNrm;
  gl_Position = uProj * vec4(aPos, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
const float D2R = 3.141592653589793 / 180.0;
const float HAZE_M = ${HAZE_M.toFixed(1)};
const float ROOF_SHADE = ${ROOF_SHADE.toFixed(4)};
in vec3 vPos;
in vec3 vNrm;
uniform vec3 uGroundNear;
uniform vec3 uGroundFar;
uniform float uLightAz;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oPos;
layout(location = 2) out vec4 oNormal;
void main() {
  vec3 n = normalize(vNrm);
  float distM = length(vPos.xy);
  float haze = 1.0 - exp(-distM / HAZE_M);
  vec3 base = mix(uGroundNear, uGroundFar, haze);
  // The roof rule from the prism shading, so a flat roof and the ground it stands on match.
  float hor = length(n.xy);
  float bearing = hor < 1e-4 ? 0.0 : atan(n.x, n.y) / D2R;
  float lit = 0.55 + 0.45 * (0.5 + 0.5 * cos((bearing - uLightAz) * D2R));
  float k = hor < 1e-4 ? ROOF_SHADE : ROOF_SHADE + hor * (lit - ROOF_SHADE);
  oColor = vec4(base * (0.42 + 0.68 * k) / 255.0, 1.0);
  oPos = vec4(vPos, 1.0);
  oNormal = vec4(n * 0.5 + 0.5, 1.0);
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

/** One level's GPU buffers; a dropped level's go back to the pool with their byte capacities. */
interface Slot {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  nbo: WebGLBuffer;
  ibo: WebGLBuffer;
  vertexBytes: number;
  indexBytes: number;
}

interface LevelGpu {
  key: MeshLevel;
  slot: Slot;
  blockStart: Int32Array;
  blockBox: Float32Array;
  blocks: number;
}

export interface TerrainGlStats {
  levels: number;
  blocks: number;
  triangles: number;
}

/** Draws consecutive passing blocks as one call; a level that fully passes costs a single draw. */
function runs(lv: LevelGpu, keep: (b: number) => boolean, out: (first: number, count: number) => void): number {
  let start = -1;
  let blocks = 0;
  for (let b = 0; b <= lv.blocks; b++) {
    const ok = b < lv.blocks && keep(b);
    if (ok) {
      blocks++;
      if (start < 0) start = b;
    } else if (start >= 0) {
      out(lv.blockStart[start], lv.blockStart[b] - lv.blockStart[start]);
      start = -1;
    }
  }
  return blocks;
}

/** Diagonal half-angle of the frame, the cone the block cull and the shadow fit share. */
const viewConeDeg = (cam: Camera) => (Math.atan(Math.hypot(cam.frameWmm, cam.frameHmm) / 2 / cam.focalMm) * 180) / Math.PI;

export class TerrainGl {
  private readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly depthProg: WebGLProgram;
  private readonly uni: Record<string, WebGLUniformLocation | null>;
  private readonly depthUni: Record<string, WebGLUniformLocation | null>;
  private levels: LevelGpu[] = [];
  private free: Slot[] = [];
  private readonly idle = new IdleRelease(() => {
    for (const s of this.free) this.deleteSlot(s);
    this.free = [];
  });

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = linkProgram(gl, VERT_SRC, FRAG_SRC, 'terrainGl');
    this.depthProg = linkProgram(gl, DEPTH_VERT_SRC, DEPTH_FRAG_SRC, 'terrainGl depth');
    this.uni = uniforms(gl, this.prog, ['uProj', 'uGroundNear', 'uGroundFar', 'uLightAz']);
    this.depthUni = uniforms(gl, this.depthProg, ['uProj']);
  }

  get ready(): boolean {
    return this.levels.length > 0;
  }

  /**
   * Extent and height range of everything uploaded, for fitting the cascades' near plane, plus the
   * axial depth range of the blocks the view cone touches, which bounds the splits. The box and
   * height range stay over every block: they bound the receivers and must not shrink to what is in
   * frame.
   */
  bounds(cam: Camera, basis: CameraBasis): SceneBounds {
    let halfM = 1;
    let minU = -1;
    let maxU = 1;
    let viewNearM = Infinity;
    let viewFarM = -Infinity;
    const F = basis.forward;
    for (const lv of this.levels)
      for (let b = 0; b < lv.blocks; b++) {
        const o = b * 6;
        halfM = Math.max(halfM, Math.abs(lv.blockBox[o]), Math.abs(lv.blockBox[o + 3]), Math.abs(lv.blockBox[o + 1]), Math.abs(lv.blockBox[o + 4]));
        minU = Math.min(minU, lv.blockBox[o + 2]);
        maxU = Math.max(maxU, lv.blockBox[o + 5]);
        // The cone range lies within the box's axial extent, so one inside the range so far adds nothing.
        if (viewFarM > viewNearM && axialNear(lv.blockBox, o, F) >= viewNearM && axialFar(lv.blockBox, o, F) <= viewFarM) continue;
        const seen = coneDepthRange(lv.blockBox, o, basis, cam);
        if (!seen) continue;
        viewNearM = Math.min(viewNearM, seen[0]);
        viewFarM = Math.max(viewFarM, seen[1]);
      }
    if (viewFarM <= viewNearM) return { halfM, minU, maxU };
    return { halfM, minU, maxU, viewNearM: Math.max(1, viewNearM), viewFarM };
  }

  /** Uploads whatever is new and drops the rest; the worker streams levels in finest first. */
  sync(meshes: readonly MeshLevel[]): void {
    const kept: LevelGpu[] = [];
    for (const m of meshes) {
      const hit = this.levels.find((l) => l.key === m);
      kept.push(hit ?? this.upload(m));
    }
    for (const l of this.levels) if (!kept.includes(l)) this.drop(l);
    this.levels = kept;
  }

  render(cam: Camera, basis: CameraBasis, groundNear: readonly number[], groundFar: readonly number[], lightAzDeg: number): TerrainGlStats {
    const gl = this.gl;
    const f = cam.focalMm;
    const coneDeg = viewConeDeg(cam);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uni.uProj, false, prismClipMatrix(cam, basis));
    gl.uniform3f(this.uni.uGroundNear, groundNear[0], groundNear[1], groundNear[2]);
    gl.uniform3f(this.uni.uGroundFar, groundFar[0], groundFar[1], groundFar[2]);
    gl.uniform1f(this.uni.uLightAz, lightAzDeg);
    let blocks = 0;
    let triangles = 0;
    for (const lv of this.levels) {
      gl.bindVertexArray(lv.slot.vao);
      blocks += runs(
        lv,
        (b) => {
          const o = b * 6;
          const ce = (lv.blockBox[o] + lv.blockBox[o + 3]) / 2;
          const cn = (lv.blockBox[o + 1] + lv.blockBox[o + 4]) / 2;
          const cu = (lv.blockBox[o + 2] + lv.blockBox[o + 5]) / 2;
          const r = Math.hypot(lv.blockBox[o + 3] - ce, lv.blockBox[o + 4] - cn, lv.blockBox[o + 5] - cu);
          return sphereVisible(ce, cn, cu, r, basis, f, cam.frameWmm, cam.frameHmm, coneDeg);
        },
        (first, count) => {
          gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4);
          triangles += count / 3;
        }
      );
    }
    gl.bindVertexArray(null);
    return { levels: this.levels.length, blocks, triangles };
  }

  /** Depth only into one cascade; a block upwind of the slab still has to cast into it. */
  renderDepth(cascade: Cascade, light: CameraBasis): number {
    const gl = this.gl;
    gl.useProgram(this.depthProg);
    gl.uniformMatrix4fv(this.depthUni.uProj, false, cascade.matrix);
    let triangles = 0;
    for (const lv of this.levels) {
      gl.bindVertexArray(lv.slot.vao);
      runs(
        lv,
        (b) => boxCastsInto(lv.blockBox, b * 6, light, cascade),
        (first, count) => {
          gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4);
          triangles += count / 3;
        }
      );
    }
    gl.bindVertexArray(null);
    return triangles;
  }

  dispose(): void {
    this.idle.cancel();
    for (const l of this.levels) this.deleteSlot(l.slot);
    for (const s of this.free) this.deleteSlot(s);
    this.levels = [];
    this.free = [];
    this.gl.deleteProgram(this.prog);
    this.gl.deleteProgram(this.depthProg);
  }

  /** Refills the tightest free slot that fits, else grows one (or makes the first); a rebuild then allocates nothing. */
  private upload(m: MeshLevel): LevelGpu {
    const gl = this.gl;
    this.idle.touch();
    const vb = m.pos.byteLength;
    const ib = m.idx.byteLength;
    let best = -1;
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i];
      if (f.vertexBytes >= vb && f.indexBytes >= ib && (best < 0 || f.vertexBytes < this.free[best].vertexBytes)) best = i;
    }
    const slot = best >= 0 ? this.free.splice(best, 1)[0] : (this.free.pop() ?? this.createSlot());
    gl.bindVertexArray(slot.vao);
    if (slot.vertexBytes < vb) {
      slot.vertexBytes = poolSize(vb);
      for (const b of [slot.vbo, slot.nbo]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, slot.vertexBytes, gl.STATIC_DRAW);
      }
    }
    if (slot.indexBytes < ib) {
      slot.indexBytes = poolSize(ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, slot.indexBytes, gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.nbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.nrm);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, m.idx);
    gl.bindVertexArray(null);
    return { key: m, slot, blockStart: m.blockStart, blockBox: m.blockBox, blocks: m.blocks };
  }

  private createSlot(): Slot {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    return { vao, vbo, nbo, ibo, vertexBytes: 0, indexBytes: 0 };
  }

  private drop(l: LevelGpu): void {
    this.idle.touch();
    this.free.push(l.slot);
  }

  private deleteSlot(s: Slot): void {
    const gl = this.gl;
    gl.deleteVertexArray(s.vao);
    gl.deleteBuffer(s.vbo);
    gl.deleteBuffer(s.nbo);
    gl.deleteBuffer(s.ibo);
  }
}
