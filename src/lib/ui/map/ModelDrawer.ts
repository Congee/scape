import { Marker, type GeoJSONSource, type Map as MaplibreMap, type MapMouseEvent } from 'maplibre-gl';
import { shallow } from 'zustand/shallow';
import type { LngLat } from '@core/geo/geodesy';
import { AltitudeRef, localToLngLat, lngLatToLocal, type ModelAnchor, type SavedModel } from '@core/model';
import { nearestWithin, snapRightAngle, withPart } from '@core/model/draw';
import { finishDraft, modelsStore } from '@state/models';
import { MarkersView, PanelTab, uiStore } from '@state/ui';
import { draftFeatures, MODEL_ACCENT, MODEL_COLOR, modelFeatures } from './modelOverlay';

const MODELS_SRC = 'models';
const DRAFT_SRC = 'model-draft';
/** Screen distance a tap or drop snaps to an Overture vertex, or closes the ring on the first one. */
const SNAP_PX = 12;
const LONG_PRESS_MS = 600;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** A heading-free frame at the first vertex, for squaring corners. */
const frameAt = (p: [number, number]): ModelAnchor => ({ lng: p[0], lat: p[1], altRef: AltitudeRef.Ground, altM: 0, headingDeg: 0, scale: 1 });

/** Draws new footprints and edits the selected part's vertices on the map, and shows the models as extrusions. */
export class ModelDrawer {
  private handles: Marker[] = [];
  private dragging = false;
  /** A drag's model before it is saved. */
  private preview: SavedModel | null = null;
  private swallowClick = false;
  private unsubs: (() => void)[] = [];

  constructor(
    private map: MaplibreMap,
    private buildingLayers: () => string[]
  ) {
    this.unsubs.push(
      modelsStore.subscribe((st) => [st.models, st.selectedId, st.selectedPartId, st.draft] as const, () => this.render(), { equalityFn: shallow }),
      modelsStore.subscribe(
        (st) => st.draft !== null,
        (on) => {
          this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
          if (on) this.map.doubleClickZoom.disable();
          else this.map.doubleClickZoom.enable();
        }
      )
    );
  }

  /** Extrusions under the labels, the draft over everything. */
  addLayers(beforeId: string | undefined) {
    if (this.map.getSource(MODELS_SRC)) return;
    this.map.addSource(MODELS_SRC, { type: 'geojson', data: EMPTY });
    this.map.addSource(DRAFT_SRC, { type: 'geojson', data: EMPTY });
    this.map.addLayer(
      {
        id: 'models-fill',
        type: 'fill-extrusion',
        source: MODELS_SRC,
        paint: {
          'fill-extrusion-color': ['case', ['get', 'current'], MODEL_ACCENT, MODEL_COLOR],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-opacity': 0.9
        }
      },
      beforeId
    );
    this.map.addLayer({
      id: 'models-line',
      type: 'line',
      source: MODELS_SRC,
      paint: { 'line-color': ['case', ['get', 'selected'], MODEL_ACCENT, MODEL_COLOR], 'line-width': ['case', ['get', 'current'], 2.5, 1.5] }
    });
    this.map.addLayer({ id: 'model-draft-fill', type: 'fill', source: DRAFT_SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': MODEL_ACCENT, 'fill-opacity': 0.18 } });
    this.map.addLayer({ id: 'model-draft-line', type: 'line', source: DRAFT_SRC, paint: { 'line-color': MODEL_ACCENT, 'line-width': 2, 'line-dasharray': [2, 1] } });
    this.render();
  }

  render() {
    const st = modelsStore.getState();
    const models = this.preview ? st.models.map((m) => (m.id === this.preview!.id ? this.preview! : m)) : st.models;
    (this.map.getSource(MODELS_SRC) as GeoJSONSource | undefined)?.setData(modelFeatures(models, st.selectedId, st.selectedPartId));
    (this.map.getSource(DRAFT_SRC) as GeoJSONSource | undefined)?.setData(draftFeatures(st.draft));
    if (!this.dragging) this.syncHandles();
  }

  /** True when the click was a drawing tap. */
  onClick(e: MapMouseEvent): boolean {
    const draft = modelsStore.getState().draft;
    if (!draft) return false;
    const target = e.originalEvent.target;
    if (this.swallowClick || (target instanceof Element && target.closest('.map-vertex'))) {
      this.swallowClick = false;
      return true;
    }
    if (draft.length >= 3) {
      const first = this.map.project(draft[0]);
      if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= SNAP_PX) {
        void this.finish();
        return true;
      }
    }
    const tap: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    const next = this.overtureVertexNear(e.point) ?? (modelsStore.getState().rightAngles ? this.squared(draft, tap) : tap);
    modelsStore.getState().setDraft([...draft, next]);
    return true;
  }

  /** Enter closes the ring, Escape drops it. */
  onKey(e: KeyboardEvent): boolean {
    const draft = modelsStore.getState().draft;
    if (!draft) return false;
    if (e.key === 'Escape') modelsStore.getState().setDraft(null);
    else if (e.key === 'Enter') void this.finish();
    else return false;
    return true;
  }

  /** Saves the draft and opens it in the editor. */
  async finish() {
    if (!(await finishDraft())) return;
    const ui = uiStore.getState();
    ui.setPanelTab(PanelTab.Markers);
    ui.setMarkersView(MarkersView.Models);
  }

  private squared(draft: readonly [number, number][], tap: [number, number]): [number, number] {
    if (draft.length < 2) return tap;
    const f = frameAt(draft[0]);
    const ring = draft.map(([lng, lat]) => lngLatToLocal(f, { lng, lat }));
    const [e, n] = snapRightAngle(ring, lngLatToLocal(f, { lng: tap[0], lat: tap[1] }));
    const g = localToLngLat(f, e, n);
    return [g.lng, g.lat];
  }

  /** The nearest rendered Overture footprint vertex within the snap radius. */
  private overtureVertexNear(pt: { x: number; y: number }): [number, number] | null {
    const layers = this.buildingLayers().filter((id) => this.map.getLayer(id));
    if (layers.length === 0) return null;
    const box: [[number, number], [number, number]] = [
      [pt.x - SNAP_PX, pt.y - SNAP_PX],
      [pt.x + SNAP_PX, pt.y + SNAP_PX]
    ];
    const coords: [number, number][] = [];
    for (const f of this.map.queryRenderedFeatures(box, { layers })) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) for (const ring of poly) for (const c of ring) coords.push([c[0], c[1]]);
    }
    const i = nearestWithin(
      coords.map((c) => this.map.project(c)),
      pt,
      SNAP_PX
    );
    return i < 0 ? null : coords[i];
  }

  /** Handles on the draft's vertices, or on the selected part's. */
  private syncHandles() {
    for (const h of this.handles) h.remove();
    this.handles = [];
    const st = modelsStore.getState();
    if (st.draft) {
      st.draft.forEach((p, i) => this.handles.push(this.handle(p, i === 0, (q, final) => this.moveDraftVertex(i, q, final), () => this.deleteDraftVertex(i), i === 0 ? () => void this.finish() : null)));
      return;
    }
    const m = st.models.find((x) => x.id === st.selectedId);
    const part = m?.parts?.find((p) => p.id === st.selectedPartId);
    if (!m || !part || !m.visible) return;
    part.ring.forEach(([e, n], i) => {
      const g = localToLngLat(m.anchor, e, n);
      this.handles.push(this.handle([g.lng, g.lat], false, (q, final) => this.movePartVertex(m, part.id, i, q, final), () => this.deletePartVertex(m, part.id, i), null));
    });
  }

  private handle(at: [number, number], first: boolean, move: (p: LngLat, final: boolean) => void, remove: () => void, tap: (() => void) | null): Marker {
    const el = document.createElement('div');
    el.className = first ? 'map-vertex first' : 'map-vertex';
    el.title = first ? 'Tap to close; hold to delete' : 'Drag to move; hold to delete';
    const mk = new Marker({ element: el, draggable: true }).setLngLat(at).addTo(this.map);
    let timer: ReturnType<typeof setTimeout> | 0 = 0;
    let held = false;
    let moved = false;
    let down: { x: number; y: number } | null = null;
    const cancel = () => {
      clearTimeout(timer);
      timer = 0;
    };
    el.addEventListener('pointerdown', (ev) => {
      held = false;
      moved = false;
      down = { x: ev.clientX, y: ev.clientY };
      timer = setTimeout(() => {
        timer = 0;
        held = true;
        this.swallowClick = true;
        remove();
      }, LONG_PRESS_MS);
    });
    el.addEventListener('pointermove', (ev) => {
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!held && !moved && tap) tap();
    });
    let raf = 0;
    const report = (final: boolean) => {
      const ll = mk.getLngLat();
      move({ lng: ll.lng, lat: ll.lat }, final);
    };
    mk.on('dragstart', () => {
      cancel();
      moved = true;
      this.dragging = true;
    });
    mk.on('drag', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        report(false);
      });
    });
    mk.on('dragend', () => {
      cancelAnimationFrame(raf);
      raf = 0;
      this.dragging = false;
      const snap = this.overtureVertexNear(this.map.project(mk.getLngLat()));
      if (snap) mk.setLngLat(snap);
      report(true);
    });
    return mk;
  }

  private moveDraftVertex(i: number, p: LngLat, final: boolean) {
    const draft = modelsStore.getState().draft;
    if (!draft) return;
    const next = draft.map((q, k) => (k === i ? ([p.lng, p.lat] as [number, number]) : q));
    if (final) modelsStore.getState().setDraft(next);
    else (this.map.getSource(DRAFT_SRC) as GeoJSONSource | undefined)?.setData(draftFeatures(next));
  }

  private deleteDraftVertex(i: number) {
    const draft = modelsStore.getState().draft;
    if (draft) modelsStore.getState().setDraft(draft.filter((_, k) => k !== i));
  }

  private movePartVertex(m: SavedModel, partId: string, i: number, p: LngLat, final: boolean) {
    const at = lngLatToLocal(m.anchor, p);
    const ring = m.parts!.find((x) => x.id === partId)?.ring;
    if (!ring) return;
    const parts = withPart(m.parts!, partId, { ring: ring.map((v, k) => (k === i ? at : v)) });
    if (final) {
      this.preview = null;
      void modelsStore.getState().update(m.id, { parts });
      return;
    }
    this.preview = { ...m, parts };
    this.render();
  }

  private deletePartVertex(m: SavedModel, partId: string, i: number) {
    const part = m.parts!.find((x) => x.id === partId);
    if (!part || part.ring.length <= 3) return;
    void modelsStore.getState().update(m.id, { parts: withPart(m.parts!, partId, { ring: part.ring.filter((_, k) => k !== i) }) });
  }

  dispose() {
    for (const u of this.unsubs) u();
    for (const h of this.handles) h.remove();
  }
}
