// Writes the P3 smoke's GLBs: a 40 m square, 300 m box with a spire to 380 m, and the same box marked Draco-compressed.
// Usage: bun scripts/smoke/models-p3-glb.ts <out-dir>
import { readGlb, replaceGlbJson, writeGlb } from '../../src/lib/core/model/gltf';

const out = process.argv[2] ?? '/tmp/models-p3';
const BOX_M = 40;
const SHAFT_M = 300;
const APEX_M = 380;

const h = BOX_M / 2;
const s = 4;
// Local e, n, u; the shaft's 8 corners, then the spire's square base and tip.
const pos = [-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0, -h, -h, SHAFT_M, h, -h, SHAFT_M, h, h, SHAFT_M, -h, h, SHAFT_M, -s, -s, SHAFT_M, s, -s, SHAFT_M, s, s, SHAFT_M, -s, s, SHAFT_M, 0, 0, APEX_M];
const quad = (a: number, b: number, c: number, d: number) => [a, b, c, a, c, d];
const spire = [8, 9, 12, 9, 10, 12, 10, 11, 12, 11, 8, 12];
// One zero-area triangle, for the sheet's dropped count.
const degenerate = [0, 0, 1];
const idx = [...quad(0, 3, 2, 1), ...quad(4, 5, 6, 7), ...quad(0, 1, 5, 4), ...quad(1, 2, 6, 5), ...quad(2, 3, 7, 6), ...quad(3, 0, 4, 7), ...spire, ...degenerate];
const plain = writeGlb({ pos: Float32Array.from(pos), idx: Uint32Array.from(idx), box: new Float32Array(6) }, undefined);
const doc = readGlb(plain).json as { asset: Record<string, unknown>; extensionsUsed?: string[]; extensionsRequired?: string[] };
const foreign = replaceGlbJson(plain, { ...doc, asset: { version: '2.0', generator: 'Scape P3 smoke' } });
const draco = replaceGlbJson(plain, { ...doc, asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] });
await Bun.write(`${out}/spire-tower.glb`, foreign);
await Bun.write(`${out}/draco-tower.glb`, draco);
console.log(`${out}/spire-tower.glb ${foreign.byteLength} B, ${out}/draco-tower.glb ${draco.byteLength} B`);
