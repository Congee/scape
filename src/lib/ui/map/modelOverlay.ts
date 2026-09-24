import type { FeatureCollection, LineString, Polygon } from 'geojson';
import { localToLngLat, modelBaseM, type SavedModel } from '@core/model';
import { modelMesh } from '@core/model/mesh';

export const MODEL_COLOR = '#e0b872';
export const MODEL_ACCENT = '#5aa9ff';

export interface ModelFeatureProps {
  model: string;
  part: string;
  /** Metres above the map's ground. */
  base: number;
  top: number;
  /** The model is the one open in the editor. */
  selected: boolean;
  /** The part the handles and nudges act on. */
  current: boolean;
}

/** One extrusion per part of each visible model; an imported mesh stands on its footprint. */
export function modelFeatures(models: readonly SavedModel[], selectedId: string | null, selectedPartId: string | null): FeatureCollection<Polygon, ModelFeatureProps> {
  const features: FeatureCollection<Polygon, ModelFeatureProps>['features'] = [];
  for (const m of models) {
    if (!m.visible) continue;
    const ground = Number.isNaN(m.groundM) ? 0 : Math.max(m.groundM, 0);
    const lift = modelBaseM(m.anchor, m.groundM) - ground;
    const s = m.anchor.scale;
    const selected = m.id === selectedId;
    if (m.parts) {
      for (const p of m.parts) {
        if (p.ring.length < 3) continue;
        const ring = p.ring.map(([e, n]) => {
          const g = localToLngLat(m.anchor, e, n);
          return [g.lng, g.lat];
        });
        ring.push(ring[0]);
        const props = { model: m.id, part: p.id, base: lift + p.baseM * s, top: lift + p.heightM * s, selected, current: selected && p.id === selectedPartId };
        features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
      }
    } else if (m.footprint.length >= 3) {
      const { box } = modelMesh(m);
      const ring = [...m.footprint, m.footprint[0]];
      const props = { model: m.id, part: '', base: lift + box[2] * s, top: lift + box[5] * s, selected, current: false };
      features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** The half-drawn ring, open until it has three vertices. */
export function draftFeatures(draft: readonly [number, number][] | null): FeatureCollection<Polygon | LineString> {
  if (!draft || draft.length === 0) return { type: 'FeatureCollection', features: [] };
  const line = draft.length >= 3 ? [...draft, draft[0]] : [...draft];
  const features: FeatureCollection<Polygon | LineString>['features'] = [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }];
  if (draft.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [line] } });
  return { type: 'FeatureCollection', features };
}
