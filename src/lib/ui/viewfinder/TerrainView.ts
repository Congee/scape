import { LngLat, Map as MaplibreMap } from 'maplibre-gl';
import '@data/maplibre';
import { styleFor, type Basemap } from '@data/basemaps';
import { ensureDemProtocol } from '@data/demProtocol';
import { ensurePmtilesProtocol } from '@data/pmtiles';
import { DEM_TILE_TEMPLATE, TERRAIN_ATTRIBUTION, TERRAIN_MAX_ZOOM } from '@data/terrainTiles';

const DEM_SRC = 'terrain-dem';
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
    this.map.setTerrain({ source: DEM_SRC, exaggeration: 1 });
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
    this.map.setSky({ 'sky-color': a.sky, 'horizon-color': a.horizon, 'fog-color': a.fog, 'fog-ground-blend': 0.6, 'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.85, 'atmosphere-blend': 0 });
    this.map.getCanvas().style.filter = a.brightness >= 0.995 ? '' : `brightness(${a.brightness.toFixed(2)})`;
  }

  dispose() {
    this.map.remove();
    this.el.remove();
  }
}
