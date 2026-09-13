import { LngLat, Map as MaplibreMap } from 'maplibre-gl';
import '@data/maplibre';
import { styleFor, type Basemap } from '@data/basemaps';
import { ensureDemProtocol } from '@data/demProtocol';
import { ensurePmtilesProtocol } from '@data/pmtiles';
import { DEM_TILE_TEMPLATE, TERRAIN_ATTRIBUTION, TERRAIN_MAX_ZOOM } from '@data/terrainTiles';

const DEM_SRC = 'terrain-dem';
const BUILDING_SRC = 'openmaptiles';
const BUILDING_LAYER = 'scape-buildings';
const BUILDING_TILES = 'https://tiles.openfreemap.org/planet';
/** PlanIt keeps building volumes light so they still read against a night sky. */
const BUILDING_COLOR = '#f4f4f6';
const KEEP_LABELS = /peak|mountain|summit/i;
/** Lifts the eye when MapLibre's mesh sits above the DEM sample, so the camera never starts underground. */
const MESH_ZOOMS = [14, 13, 12, 11];

const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameraPose {
  lng: number;
  lat: number;
  /** Eye above sea level, metres. */
  altM: number;
  eyeAboveGroundM: number;
  azimuthDeg: number;
  elevationDeg: number;
  vfovDeg: number;
}

export interface Atmosphere {
  sky: string;
  horizon: string;
  fog: string;
  /** 1 by day; the basemap is dimmed towards 0 at night. */
  brightness: number;
}

/** The map's 3D terrain seen from the camera position, drawn under the viewfinder canvas. */
export class TerrainView {
  readonly el = document.createElement('div');
  private map: MaplibreMap;
  private styleReady = false;
  private lastRect = '';
  private lastPose = '';
  private lastFov = -1;
  private lastSky = '';
  private atmosphere: Atmosphere | null = null;
  private terrainOn = true;

  constructor(parent: HTMLElement, rect: Rect, basemap: Basemap, pose: CameraPose, private onChange: () => void) {
    this.el.className = 'vf-3d';
    this.place(rect);
    parent.prepend(this.el);
    ensurePmtilesProtocol();
    ensureDemProtocol();
    this.map = new MaplibreMap({
      container: this.el,
      style: styleFor(basemap),
      interactive: false,
      attributionControl: { compact: true },
      maxPitch: 180,
      maxZoom: 24,
      // An explicit pose: without one the style's own centre would show until the first jumpTo lands.
      center: [finite(pose.lng, 0), finite(pose.lat, 0)],
      zoom: 14,
      bearing: finite(pose.azimuthDeg, 0),
      pitch: 90,
      fadeDuration: 0,
      renderWorldCopies: false
    });
    this.map.setCenterClampedToGround(false);
    this.map.on('style.load', () => {
      this.prepareStyle();
      this.styleReady = true;
      this.lastSky = '';
      if (this.atmosphere) this.applyAtmosphere(this.atmosphere);
      this.onChange();
    });
    if (import.meta.env.DEV) (window as unknown as { __scapeView3d?: MaplibreMap }).__scapeView3d = this.map;
    this.map.on('error', (e) => console.warn('[scape] 3D view:', e.error?.message ?? e));
    // MapLibre unfolds the compact attribution once it has content and folds it on a drag, which this map never gets.
    const fold = () => {
      const attrib = this.el.querySelector('.maplibregl-ctrl-attrib');
      if (!attrib?.classList.contains('maplibregl-compact-show')) return;
      attrib.removeAttribute('open');
      attrib.classList.remove('maplibregl-compact-show');
      this.map.off('sourcedata', fold);
    };
    this.map.on('sourcedata', fold);
  }

  /** True once the basemap is drawing, so the canvas may leave the ground transparent. */
  ready(): boolean {
    return this.styleReady;
  }

  setBasemap(b: Basemap) {
    this.styleReady = false;
    // A new style may reset the transform, so the next update must re-apply the camera.
    this.lastPose = '';
    this.map.setStyle(styleFor(b));
    this.onChange();
  }

  private prepareStyle() {
    // Billboard labels make no sense at eye level; peaks would, if a style had them.
    for (const l of this.map.getStyle().layers) if (l.type === 'symbol' && !KEEP_LABELS.test(l.id)) this.map.removeLayer(l.id);
    if (!this.map.getSource(DEM_SRC)) {
      this.map.addSource(DEM_SRC, { type: 'raster-dem', tiles: [DEM_TILE_TEMPLATE], tileSize: 256, encoding: 'terrarium', maxzoom: TERRAIN_MAX_ZOOM, attribution: TERRAIN_ATTRIBUTION });
    }
    this.applyTerrain();
    this.prepareBuildings();
  }

  /** Buildings are the subject at long focal lengths, so every basemap gets a light volume, raster ones included. */
  private prepareBuildings() {
    let any = false;
    for (const l of this.map.getStyle().layers) {
      if (l.type !== 'fill-extrusion' || l['source-layer'] !== 'building') continue;
      any = true;
      this.paintBuildings(l.id);
    }
    if (any || !navigator.onLine) return;
    if (!this.map.getSource(BUILDING_SRC)) this.map.addSource(BUILDING_SRC, { type: 'vector', url: BUILDING_TILES });
    this.map.addLayer({
      id: BUILDING_LAYER,
      type: 'fill-extrusion',
      source: BUILDING_SRC,
      'source-layer': 'building',
      minzoom: 14,
      filter: ['!=', ['get', 'hide_3d'], true],
      paint: { 'fill-extrusion-height': ['get', 'render_height'], 'fill-extrusion-base': ['get', 'render_min_height'] }
    });
    this.paintBuildings(BUILDING_LAYER);
  }

  private paintBuildings(id: string) {
    this.map.setPaintProperty(id, 'fill-extrusion-color', BUILDING_COLOR);
    this.map.setPaintProperty(id, 'fill-extrusion-opacity', 1);
    this.map.setPaintProperty(id, 'fill-extrusion-vertical-gradient', true);
  }

  private applyTerrain() {
    this.map.setTerrain(this.terrainOn ? { source: DEM_SRC, exaggeration: 1 } : null);
    // Dropping the mesh does not always redraw on its own, and the frame would keep the stale empty render.
    this.map.triggerRepaint();
  }

  /**
   * MapLibre draws nothing at all once the frame clears the horizon and the terrain mesh leaves the frustum,
   * which is exactly where a long lens finds the towers. With no ground in frame the mesh has nothing to show anyway.
   */
  private wantTerrain(on: boolean) {
    if (on === this.terrainOn) return;
    this.terrainOn = on;
    if (this.styleReady) this.applyTerrain();
  }

  private place(r: Rect) {
    const key = `${r.x}|${r.y}|${r.w}|${r.h}`;
    if (key === this.lastRect) return false;
    this.lastRect = key;
    this.el.style.left = `${r.x}px`;
    this.el.style.top = `${r.y}px`;
    this.el.style.width = `${r.w}px`;
    this.el.style.height = `${r.h}px`;
    return true;
  }

  private meshGroundM(p: LngLat): number {
    const terrain = this.map.terrain;
    if (!terrain) return Number.NEGATIVE_INFINITY;
    for (const z of MESH_ZOOMS) {
      const m = terrain.getElevationForLngLatZoom(p, z);
      if (m) return m;
    }
    return Number.NEGATIVE_INFINITY;
  }

  update(rect: Rect, pose: CameraPose, atmosphere: Atmosphere) {
    if (this.place(rect)) this.map.resize();
    if (Number.isFinite(pose.vfovDeg) && pose.vfovDeg !== this.lastFov) {
      this.lastFov = pose.vfovDeg;
      this.map.setVerticalFieldOfView(pose.vfovDeg);
    }
    const at = new LngLat(finite(pose.lng, 0), finite(pose.lat, 0));
    const altM = Math.max(finite(pose.altM, 0), this.meshGroundM(at) + finite(pose.eyeAboveGroundM, 0)) + 0.5;
    const az = finite(pose.azimuthDeg, 0);
    const el = finite(pose.elevationDeg, 0);
    this.wantTerrain(el - finite(pose.vfovDeg, 0) / 2 <= 0);
    // A NaN would leave MapLibre on its previous camera, showing another place entirely; the key is only
    // recorded once the jump lands, so a throw here cannot mark a pose as applied.
    const key = Number.isFinite(pose.lng) && Number.isFinite(pose.lat) && Number.isFinite(altM) ? `${at.lng.toFixed(6)}|${at.lat.toFixed(6)}|${altM.toFixed(1)}|${az.toFixed(3)}|${el.toFixed(3)}` : '';
    if (key && key !== this.lastPose) {
      this.map.jumpTo(this.map.calculateCameraOptionsFromCameraLngLatAltRotation(at, altM, az, 90 + el, 0));
      this.lastPose = key;
    }
    this.atmosphere = atmosphere;
    if (this.styleReady) this.applyAtmosphere(atmosphere);
  }

  private applyAtmosphere(a: Atmosphere) {
    const key = `${a.sky}|${a.horizon}|${a.fog}|${a.brightness.toFixed(2)}`;
    if (key === this.lastSky) return;
    this.lastSky = key;
    // The dim is a filter over the whole canvas, so the sky is pre-lifted to land on the palette colour the frame expects.
    const lift = (c: string) => c.replace(/\d+/g, (n) => `${Math.min(255, Math.round(Number(n) / a.brightness))}`);
    this.map.setSky({ 'sky-color': lift(a.sky), 'horizon-color': lift(a.horizon), 'fog-color': lift(a.fog), 'fog-ground-blend': 0.6, 'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.85, 'atmosphere-blend': 0 });
    this.map.getCanvas().style.filter = a.brightness >= 0.995 ? '' : `brightness(${a.brightness.toFixed(2)})`;
  }

  dispose() {
    this.map.remove();
    this.el.remove();
  }
}
