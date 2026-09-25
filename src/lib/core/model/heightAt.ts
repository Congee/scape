/** Target height from a precise model, ahead of the Overture lookup. */

import type { LngLat } from '@core/geo/geodesy';
import { inLngLatRing, modelBaseM, modelOutlines, type SavedModel } from '@core/model';
import { modelTopM } from './mesh';

/** Apex above the model's ground under `p`, from the first visible model with an outline holding it. */
export function modelHeightAt(models: readonly SavedModel[], p: LngLat): { heightM: number; model: SavedModel } | null {
  for (const m of models) {
    if (!m.visible || !inLngLatRing(m.footprint, p) || !modelOutlines(m).some((r) => inLngLatRing(r, p))) continue;
    const ground = Number.isNaN(m.groundM) ? 0 : m.groundM;
    const heightM = modelBaseM(m.anchor, m.groundM) - ground + modelTopM(m) * m.anchor.scale;
    if (!Number.isFinite(heightM)) throw new Error(`Model “${m.name}” height is not finite`);
    return { heightM, model: m };
  }
  return null;
}
