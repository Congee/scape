/** Target height from a precise model, ahead of the Overture lookup. */

import type { LngLat } from '@core/geo/geodesy';
import { inLngLatRing, modelBaseM, modelOutlines, type SavedModel } from '@core/model';
import { modelApexM } from './seed';

/** Apex above the model's ground under `p`, from the first visible model with an outline holding it. */
export function modelHeightAt(models: readonly SavedModel[], p: LngLat): { heightM: number; model: SavedModel } | null {
  for (const m of models) {
    if (!m.visible || !m.parts || !inLngLatRing(m.footprint, p) || !modelOutlines(m).some((r) => inLngLatRing(r, p))) continue;
    const ground = Number.isNaN(m.groundM) ? 0 : Math.max(m.groundM, 0);
    return { heightM: modelBaseM(m.anchor, m.groundM) - ground + modelApexM(m.parts) * m.anchor.scale, model: m };
  }
  return null;
}
