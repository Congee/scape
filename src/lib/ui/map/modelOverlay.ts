import type { FeatureCollection, LineString, Polygon } from 'geojson';
import type { LayerSpecification } from 'maplibre-gl';
import { localToLngLat, modelBaseM, type SavedModel } from '@core/model';
import { modelMesh } from '@core/model/mesh';

export const MODEL_COLOR = '#e0b872';
export const MODEL_ACCENT = '#5aa9ff';
export const MODELS_FILL_LAYER = 'models-fill';
export const MODELS_LINE_LAYER = 'models-line';
export const OTHER_MODELS_FILL_LAYER = 'models-fill-others';

const fillLayer = (id: string, source: string, selected: boolean): LayerSpecification => ({
  id,
  type: 'fill-extrusion',
  source,
  filter: ['==', ['get', 'selected'], selected],
  paint: {
    'fill-extrusion-color': ['case', ['get', 'current'], MODEL_ACCENT, MODEL_COLOR],
    'fill-extrusion-base': ['get', 'base'],
    'fill-extrusion-height': ['get', 'top'],
    'fill-extrusion-opacity': 0.9
  }
});

const outlineLayer = (id: string, source: string, selected: boolean): LayerSpecification => ({
  id,
  type: 'line',
  source,
  filter: ['==', ['get', 'selected'], selected],
  paint: { 'line-color': selected ? MODEL_ACCENT : MODEL_COLOR, 'line-width': ['case', ['get', 'current'], 2.5, 1.5] }
});

/**
 * Bottom to top: the selected model, its outline, the other models, their outlines. Lines keep no depth, so
 * extrusions drawn after the selected outline (other models, then buildings) hide it where they stand in front.
 */
export function modelLayers(source: string): LayerSpecification[] {
  return [fillLayer(MODELS_FILL_LAYER, source, true), outlineLayer(MODELS_LINE_LAYER, source, true), fillLayer(OTHER_MODELS_FILL_LAYER, source, false), outlineLayer('models-line-others', source, false)];
}

/** Where to test a vertex handle for cover: `stepPx` inside its footprint, so a wall it shares with a neighbour does not count. */
export function coverProbe(v: { x: number; y: number }, centre: { x: number; y: number }, stepPx: number): { x: number; y: number } {
  const d = Math.hypot(centre.x - v.x, centre.y - v.y);
  if (d === 0) return { x: v.x, y: v.y };
  const k = Math.min(stepPx, d / 2) / d;
  return { x: v.x + (centre.x - v.x) * k, y: v.y + (centre.y - v.y) * k };
}

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
    const ground = Number.isNaN(m.groundM) ? 0 : m.groundM;
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
