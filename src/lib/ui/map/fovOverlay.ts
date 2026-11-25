import type { GeoJSONSource, Map as MaplibreMap, Marker } from 'maplibre-gl';
import { bearingDeg, destination, distanceM } from '@core/geo/geodesy';
import { depthOfField } from '@core/optics/dof';
import { cocMm, effectiveOptics, focalForFovMm, fovDeg, frameMm, sensorPixels, tcFactor } from '@core/optics/fov';
import { aimFor, compositionStore } from '@state/composition';
import { gearStore, sensorById, zoomPatch } from '@state/gear';
import { settingsStore } from '@state/settings';
import { worldStore } from '@state/world';
import { HALO, Ink } from '../inks';
import { draggableMarker, type MarkerOpts } from './draggableMarker';
import { EMPTY, samePoint } from './mapShared';
import { FovKind, fovCone } from './overlays';

const FOV_SRC = 'fov';
const FOV_COLOR = Ink.edit;
const DEFAULT_FOV_RANGE_M = 5_000;

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function handleElement(title: string, cls: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `fov-handle ${cls}`;
  el.title = title;
  return el;
}

/** Cone from the camera along the aim, with draggable tip (azimuth, length) and edge (focal length) handles. */
export class FovOverlay {
  private handle: Marker | null = null;
  private edgeHandle: Marker | null = null;
  private dragging = false;
  private readonly unsubs: (() => void)[];

  constructor(
    private readonly map: MaplibreMap,
    private readonly styleReady: () => boolean
  ) {
    this.unsubs = [
      worldStore.subscribe((st) => st.pin, () => this.render(), { equalityFn: samePoint }),
      worldStore.subscribe((st) => st.pin2, () => this.render(), { equalityFn: samePoint }),
      compositionStore.subscribe(() => this.render()),
      gearStore.subscribe(() => this.render()),
      settingsStore.subscribe((st) => st.cocRule, () => this.render())
    ];
  }

  addLayers() {
    this.map.addSource(FOV_SRC, { type: 'geojson', data: EMPTY });
    this.map.addLayer({
      id: 'fov-fill',
      type: 'fill',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Fill],
      paint: { 'fill-color': FOV_COLOR, 'fill-opacity': 0.14 }
    });
    this.map.addLayer({
      id: 'fov-pano',
      type: 'line',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Pano],
      paint: { 'line-color': FOV_COLOR, 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [3, 3] }
    });
    this.map.addLayer({
      id: 'fov-axis',
      type: 'line',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Axis],
      paint: { 'line-color': FOV_COLOR, 'line-width': 1, 'line-opacity': 0.6, 'line-dasharray': [2, 4] }
    });
    this.map.addLayer({
      id: 'fov-dof',
      type: 'line',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Dof],
      paint: { 'line-color': FOV_COLOR, 'line-width': 2, 'line-opacity': 0.6 }
    });
    this.map.addLayer({
      id: 'fov-edge-casing',
      type: 'line',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Edge],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': HALO, 'line-width': 6 }
    });
    this.map.addLayer({
      id: 'fov-edge',
      type: 'line',
      source: FOV_SRC,
      filter: ['==', ['get', 'kind'], FovKind.Edge],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': FOV_COLOR, 'line-width': 2 }
    });
  }

  private marker(opts: MarkerOpts, commit: (p: { lng: number; lat: number }) => void) {
    const { marker, cancel } = draggableMarker(this.map, opts, commit, (d) => (this.dragging = d));
    this.unsubs.push(cancel);
    return marker;
  }

  render() {
    const src = this.styleReady() ? (this.map.getSource(FOV_SRC) as GeoJSONSource | undefined) : undefined;
    if (!src) return;
    const w = worldStore.getState();
    const c = compositionStore.getState();
    if (!c.showFov) {
      src.setData(EMPTY);
      this.handle?.remove();
      this.edgeHandle?.remove();
      this.handle = this.edgeHandle = null;
      return;
    }
    const sensor = sensorById(c.sensorId, gearStore.getState().cameras);
    const frame = frameMm(sensor, c.orientation);
    const opt = effectiveOptics(c);
    const hfov = fovDeg(frame.w, opt.focalMm);
    const aim = aimFor(c, w, null);
    const targetM = w.pin2 ? distanceM(w.pin, w.pin2) : null;
    const rangeM = c.fovRangeM ?? targetM ?? DEFAULT_FOV_RANGE_M;
    const focusM = c.focusDistM ?? targetM;
    const dof = focusM ? depthOfField(opt.focalMm, opt.fNumber, cocMm(sensor, sensorPixels(sensor), settingsStore.getState().cocRule), focusM) : null;
    src.setData(fovCone(w.pin, aim.azimuthDeg, hfov, { rangeM, dofNearM: dof?.nearM, dofFarM: dof?.farM, panoDeg: c.panoTotalDeg }));

    if (this.dragging) return;
    const tip = destination(w.pin, aim.azimuthDeg, rangeM);
    const edge = destination(w.pin, aim.azimuthDeg - hfov / 2, rangeM);
    if (!this.handle) {
      this.handle = this.marker({ at: tip, element: handleElement('Drag to aim the camera and set the cone length', 'tip') }, (p) => {
        const cs = compositionStore.getState();
        const a = aimFor(cs, worldStore.getState(), null);
        cs.aim(bearingDeg(worldStore.getState().pin, p), a.elevationDeg);
        cs.update({ fovRangeM: Math.max(50, distanceM(worldStore.getState().pin, p)) });
      });
      this.edgeHandle = this.marker({ at: edge, element: handleElement('Drag to change the focal length', 'edge') }, (p) => {
        const cs = compositionStore.getState();
        const ws = worldStore.getState();
        const a = aimFor(cs, ws, null);
        const half = Math.max(0.5, angleDiff(bearingDeg(ws.pin, p), a.azimuthDeg));
        const fr = frameMm(sensorById(cs.sensorId, gearStore.getState().cameras), cs.orientation);
        cs.update(zoomPatch(cs, focalForFovMm(fr.w, half * 2) / tcFactor(cs.teleconverters)));
      });
      return;
    }
    this.handle.setLngLat([tip.lng, tip.lat]);
    this.edgeHandle!.setLngLat([edge.lng, edge.lat]);
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.handle?.remove();
    this.edgeHandle?.remove();
  }
}
