import type { Occluder } from '@core/geo/meshOcclude';
import type { SurfaceMesh } from '@core/geo/surfaces';
import { silhouetteEdges, visibleRuns } from '@core/model/draw';
import { projectDir } from '@core/optics/projection';
import { occluded, type ViewProfile } from '@core/terrain/view';
import { compositionStore } from '@state/composition';
import { modelsStore } from '@state/models';
import { settingsStore } from '@state/settings';
import { MODEL_ACCENT } from '../map/modelOverlay';
import { clipToArea, type Scene } from './paint';

const R2D = 180 / Math.PI;
/** The selected model's outline is tested for occluders about this often along its length. */
const OUTLINE_STEP_PX = 3;
const OUTLINE_MAX_PX = 4000;
/** Occlusion tests per frame for the outline; a dense mesh gets coarser steps. */
const OUTLINE_SAMPLES = 6000;

/** The selected model's outline, eye-relative e, n, u pairs. */
export type OutlineMemo = { outline: { key: string; seg: Float32Array } | null };

/** Accent silhouette of the selected model, over the picture; terrain and buildings in front hide it. */
export function drawModelOutline(ctx: CanvasRenderingContext2D, sc: Scene, occ: Occluder | null, cache: { key: string; meshes: SurfaceMesh[]; ids: string[] } | null, memo: OutlineMemo) {
  const dev = import.meta.env.DEV ? (window as unknown as { __scape?: Record<string, unknown> }).__scape : undefined;
  const id = modelsStore.getState().selectedId;
  const shown = compositionStore.getState().showBuildings && settingsStore.getState().terrain;
  const at = shown && id && cache ? cache.ids.indexOf(id) : -1;
  if (!cache || at < 0) {
    if (dev) dev.modelOutline = null;
    return;
  }
  const key = `${cache.key}|${id}`;
  if (memo.outline?.key !== key) memo.outline = { key, seg: silhouetteEdges(cache.meshes[at].pos, cache.meshes[at].idx) };
  const F = sc.basis.forward;
  const cx = sc.frame.x + sc.frame.w / 2;
  const cy = sc.frame.y + sc.frame.h / 2;
  const px = (e: number, n: number, u: number) => {
    const p = projectDir(sc.cam, sc.basis, { x: e, y: n, z: u });
    return p && { x: cx + p.x * sc.frame.pxPerMm, y: cy - p.y * sc.frame.pxPerMm };
  };
  const seg = visibleOutline(occ, sc.view, memo.outline.seg, px);
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let drawn = 0;
  clipToArea(ctx, sc.area);
  ctx.strokeStyle = MODEL_ACCENT;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i + 5 < seg.length; i += 6) {
    let [ae, an, au, be, bn, bu] = [seg[i], seg[i + 1], seg[i + 2], seg[i + 3], seg[i + 4], seg[i + 5]];
    const da = ae * F.x + an * F.y + au * F.z;
    const db = be * F.x + bn * F.y + bu * F.z;
    if (da <= 0.1 && db <= 0.1) continue;
    // Clip at a near plane 10 cm ahead so a segment passing beside the eye still draws.
    if (da <= 0.1 || db <= 0.1) {
      const t = (0.1 - da) / (db - da);
      const [ce, cn, cu] = [ae + (be - ae) * t, an + (bn - an) * t, au + (bu - au) * t];
      if (da <= 0.1) [ae, an, au] = [ce, cn, cu];
      else [be, bn, bu] = [ce, cn, cu];
    }
    const p = px(ae, an, au);
    const q = px(be, bn, bu);
    if (!p || !q) continue;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    drawn++;
    box.x0 = Math.min(box.x0, p.x, q.x);
    box.y0 = Math.min(box.y0, p.y, q.y);
    box.x1 = Math.max(box.x1, p.x, q.x);
    box.y1 = Math.max(box.y1, p.y, q.y);
  }
  ctx.stroke();
  ctx.restore();
  if (dev) dev.modelOutline = { id, segments: drawn, box: drawn > 0 ? box : null };
}

/** The outline's pieces not behind terrain or a building, sampled every few pixels within a per-frame budget. */
function visibleOutline(occ: Occluder | null, view: ViewProfile | null, seg: Float32Array, px: (e: number, n: number, u: number) => { x: number; y: number } | null): Float32Array {
  if (!occ && !view) return seg;
  const lenPx = new Float32Array(seg.length / 6);
  let total = 0;
  for (let i = 0; i < lenPx.length; i++) {
    const p = px(seg[i * 6], seg[i * 6 + 1], seg[i * 6 + 2]);
    const q = px(seg[i * 6 + 3], seg[i * 6 + 4], seg[i * 6 + 5]);
    lenPx[i] = p && q ? Math.min(Math.hypot(q.x - p.x, q.y - p.y), OUTLINE_MAX_PX) : OUTLINE_MAX_PX / 8;
    total += lenPx[i] / OUTLINE_STEP_PX;
  }
  const scale = Math.min(1, OUTLINE_SAMPLES / Math.max(total, 1));
  return visibleRuns(
    seg,
    (i) => Math.ceil((lenPx[i] / OUTLINE_STEP_PX) * scale),
    (e, n, u) => {
      const h = Math.hypot(e, n);
      const d = Math.hypot(h, u);
      // Short of the point itself, so the model's own faces through it do not count.
      const slack = 0.05 + d * 1e-4;
      return (!!view && occluded(view, Math.atan2(e, n) * R2D, Math.atan2(u, h) * R2D, h - slack)) || (!!occ && occ.occludes(e, n, u, d - slack));
    }
  );
}
