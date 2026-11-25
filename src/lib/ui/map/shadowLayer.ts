import type { ImageSource, Map as MaplibreMap } from 'maplibre-gl';
import { makeObserver, SkyBody } from '@core/astro/bodies';
import { lightAt } from '@core/astro/lightSource';
import { EARTH_RADIUS_M, type LngLat } from '@core/geo/geodesy';
import { frameOf, keepsCentre, MASK_SNAP_CELLS, maskCorners, maskFrame, maskPixels, maskRect, MOON_SHADOW_RGB, SHADOW_RGB, type MaskRect } from '@core/geo/shadowMask';
import { lod2Credits, type Lod2Source } from '@core/lod2/regions';
import { GEOID_DOWNLOAD_URL, geoidCredit } from '@data/geoid';
import { buildingsStore, requestShadowMask, type ShadowMaskField } from '@state/buildings';
import { offlineStore } from '@state/offline';
import { settingsStore } from '@state/settings';
import { pinSiteHeightM, terrainStore } from '@state/terrain';
import { planTime, worldStore } from '@state/world';
import { BLD_LAYER, BLD_MIN_ZOOM } from './buildingsLayer';
import { BLANK_PNG, samePoint } from './mapShared';
import { MODELS_FILL_LAYER } from './modelOverlay';

const SHADOW_SRC = 'sun-shadow';
const SHADOW_LAYER = 'sun-shadow';
// An empty, invisible source that only carries the mask's LoD2 credit while the mask uses it.
const SHADOW_CREDIT_SRC = 'sun-shadow-credit';
/** Below this the mask's cell outgrows the coarsest DEM zoom and its tile count runs away: 12 tiles here, 108 two zooms out. */
const SHADOW_MIN_ZOOM = 8;
const SHADOW_OPACITY = 0.35;
/** Shadow edges ramp over this depth below the ceiling; the sun's own width is about this soft. */
const SHADOW_SOFT_M = 5;
/** Several triggers fire together and the build is a worker round trip, so coalesce them. */
const SHADOW_DEBOUNCE_MS = 180;
const D2R = Math.PI / 180;
const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;
/** Upper bounds on a shadow's reach, sizing the mask rect past the viewport edge. */
const TALLEST_BUILDING_M = 600;
const SHADOW_MAX_LENGTH_M = 5_000;
/** Relief that can throw a shadow into the view from outside it — an Alpine wall, not Everest. */
const TALLEST_TERRAIN_M = 3_000;
const SHADOW_MAX_TERRAIN_M = 40_000;

/** Snapped to a lattice of `stepM`, so a small pan asks the worker for the grid it already has. */
function snapPoint(p: LngLat, stepM: number): LngLat {
  const stepLat = stepM / M_PER_DEG_LAT;
  const lat = Math.round(p.lat / stepLat) * stepLat;
  const stepLng = stepM / Math.max(1, M_PER_DEG_LAT * Math.cos(lat * D2R));
  return { lat, lng: Math.round(p.lng / stepLng) * stepLng };
}

/** The sun or moon shadow mask over terrain and roofs, built in the worker and credited while it draws on LoD2. */
export class ShadowLayer {
  private timer: ReturnType<typeof setTimeout> | 0 = 0;
  /** Frame centre of the last shadow request, kept while the view stays near it. */
  private centre: LngLat | null = null;
  private painted: { src: ImageSource; mask: ShadowMaskField } | null = null;
  /** Body behind the mask on screen; the smoke test reads it. */
  lightBody: SkyBody | null = null;
  private readonly unsubs: (() => void)[];

  constructor(
    private readonly map: MaplibreMap,
    private readonly styleReady: () => boolean
  ) {
    const onMove = () => this.schedule();
    map.on('moveend', onMove);
    this.unsubs = [
      () => map.off('moveend', onMove),
      buildingsStore.subscribe((st) => st.shadowMask, () => this.paint()),
      worldStore.subscribe((st) => st.pin, () => this.schedule(), { equalityFn: samePoint }),
      // Live, shadows follow the minute: a clock showing seconds must not rebuild them.
      worldStore.subscribe(planTime, () => {
        // A live tick needs no debounce, and a timer per tick keeps an idle page awake.
        if (worldStore.getState().live) this.request();
        else this.schedule();
      }),
      settingsStore.subscribe((st) => st.showSunShadows, () => this.apply()),
      settingsStore.subscribe((st) => st.lightSource, () => this.schedule())
    ];
  }

  /** The mask covers terrain as well as roofs, so it lives and dies with its own setting. */
  apply() {
    if (!this.styleReady()) return;
    const on = settingsStore.getState().showSunShadows;
    if (on && !this.map.getLayer(SHADOW_LAYER)) {
      if (!this.map.getSource(SHADOW_SRC)) this.map.addSource(SHADOW_SRC, { type: 'image', url: BLANK_PNG, coordinates: [[-1, 1], [1, 1], [1, -1], [-1, -1]] });
      // Under the models and the extrusions, whichever went up first.
      const before = [MODELS_FILL_LAYER, BLD_LAYER].find((id) => this.map.getLayer(id)) ?? this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      this.map.addLayer(
        {
          id: SHADOW_LAYER,
          type: 'raster',
          source: SHADOW_SRC,
          layout: { visibility: 'none' },
          // A cross-fade would flicker on every rebuild; one raster composite cannot compound.
          paint: { 'raster-opacity': SHADOW_OPACITY, 'raster-fade-duration': 0 }
        },
        before
      );
    } else if (!on && this.map.getLayer(SHADOW_LAYER)) {
      this.map.removeLayer(SHADOW_LAYER);
      this.credit([]);
    }
    this.schedule();
  }

  /** The build is async through the worker, so it is debounced rather than driven per frame. */
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.request(), SHADOW_DEBOUNCE_MS);
  }

  private request() {
    if (!this.styleReady() || !this.map.getLayer(SHADOW_LAYER)) return;
    const s = settingsStore.getState();
    if (!s.showSunShadows || this.map.getZoom() < SHADOW_MIN_ZOOM) return this.hide();
    const w = worldStore.getState();
    const light = lightAt(s.lightSource, new Date(planTime(w)), makeObserver(w.pin, pinSiteHeightM(w, terrainStore.getState())));
    this.lightBody = light?.body ?? null;
    if (!light) return this.hide();
    const buildings = s.showBuildings && this.map.getZoom() >= BLD_MIN_ZOOM;
    const b = this.bounds(light.altitudeDeg, light.azimuthDeg, buildings);
    const c = this.map.getCenter();
    // Sized against the true centre, then rebuilt around a snapped one so a small pan reuses the grid.
    const rough = this.rect({ lng: c.lng, lat: c.lat }, b);
    const step = rough.cellM * MASK_SNAP_CELLS;
    // A coarser grid snaps to a sparser lattice; moving the frame then would re-stamp every cell and drop the grown rect.
    const last = this.centre;
    const centre = last && keepsCentre(last, c, step) ? last : snapPoint({ lng: c.lng, lat: c.lat }, step);
    this.centre = centre;
    const maxLenM = buildings ? SHADOW_MAX_LENGTH_M : SHADOW_MAX_TERRAIN_M;
    requestShadowMask(centre, this.rect(centre, b), light.azimuthDeg, light.altitudeDeg, SHADOW_SOFT_M, buildings, maxLenM, this.finestMPerPx());
    // A toggle back on finds the store unchanged; the mask already in hand goes back up.
    this.paint();
  }

  /** Ground metres per pixel along the bottom edge, where a pitched view is at its finest. */
  private finestMPerPx(): number {
    const { clientWidth: w, clientHeight: h } = this.map.getContainer();
    const a = this.map.unproject([w / 2 - 50, h - 1]);
    const b = this.map.unproject([w / 2 + 50, h - 1]);
    return Math.max(a.distanceTo(b) / 100, 1e-3);
  }

  private rect(centre: LngLat, b: { west: number; east: number; south: number; north: number }): MaskRect {
    const f = maskFrame(centre);
    const sw = frameOf(f, { lng: b.west, lat: b.south });
    const ne = frameOf(f, { lng: b.east, lat: b.north });
    return maskRect(sw.e, ne.e, sw.n, ne.n);
  }

  private hide() {
    // setLayoutProperty repaints even when the value is unchanged, and a sunless tick lands here.
    if (this.map.getLayer(SHADOW_LAYER) && this.map.getLayoutProperty(SHADOW_LAYER, 'visibility') !== 'none') this.map.setLayoutProperty(SHADOW_LAYER, 'visibility', 'none');
    this.credit([]);
  }

  private credit(ids: readonly Lod2Source[]) {
    if (!this.styleReady()) return;
    const regions = lod2Credits(ids);
    const geoid = regions.some((r) => r.gsiGeoid) ? offlineStore.getState().geoid : null;
    const text = [...regions.map((r) => `<a href="${r.attributionUrl}">${r.attribution}</a>`), ...(geoid ? [`<a href="${GEOID_DOWNLOAD_URL}">${geoidCredit(geoid.version)}</a>`] : [])].join(' · ');
    const src = this.map.getSource(SHADOW_CREDIT_SRC);
    if ((src?.attribution ?? '') === text) return;
    if (src) {
      this.map.removeLayer(SHADOW_CREDIT_SRC);
      this.map.removeSource(SHADOW_CREDIT_SRC);
    }
    if (!text) return;
    this.map.addSource(SHADOW_CREDIT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: text });
    this.map.addLayer({ id: SHADOW_CREDIT_SRC, type: 'fill', source: SHADOW_CREDIT_SRC, paint: { 'fill-opacity': 0 } });
  }

  /** Keeps the previous image on screen until the worker answers. */
  private paint() {
    const m = buildingsStore.getState().shadowMask;
    const src = this.styleReady() ? (this.map.getSource(SHADOW_SRC) as ImageSource | undefined) : undefined;
    if (!m || !src || !this.map.getLayer(SHADOW_LAYER)) return;
    // Every clock tick lands here; re-uploading an unchanged mask repaints the map for nothing.
    if (this.painted?.src === src && this.painted.mask === m && this.map.getLayoutProperty(SHADOW_LAYER, 'visibility') === 'visible') return;
    this.painted = { src, mask: m };
    const rgb = this.lightBody === SkyBody.Moon ? MOON_SHADOW_RGB : SHADOW_RGB;
    src.updateImage({ image: new ImageData(maskPixels(m.mask, m.nx, m.ny, rgb), m.nx, m.ny), coordinates: maskCorners(m.centre, m) });
    this.map.setLayoutProperty(SHADOW_LAYER, 'visibility', 'visible');
    this.credit(m.lod2);
  }

  /**
   * The viewport grown up-sun by the longest shadow the caster in play could throw into it. One
   * 1024 px mask cannot hold a roof-sized cell and terrain's reach at once, so the pad follows the caster.
   */
  private bounds(altDeg: number, azDeg: number, buildings: boolean): { west: number; east: number; south: number; north: number } {
    const b = this.map.getBounds();
    const tallest = buildings ? TALLEST_BUILDING_M : TALLEST_TERRAIN_M;
    const longest = buildings ? SHADOW_MAX_LENGTH_M : SHADOW_MAX_TERRAIN_M;
    const padM = Math.min(tallest / Math.tan(altDeg * D2R), longest);
    const north = Math.max(0, Math.cos(azDeg * D2R)) * padM;
    const south = Math.max(0, -Math.cos(azDeg * D2R)) * padM;
    const east = Math.max(0, Math.sin(azDeg * D2R)) * padM;
    const west = Math.max(0, -Math.sin(azDeg * D2R)) * padM;
    // The widest degree at any latitude the padded box reaches.
    const absLat = Math.min(89, Math.max(Math.abs(b.getNorth()), Math.abs(b.getSouth())) + padM / M_PER_DEG_LAT);
    const perLng = Math.max(1, M_PER_DEG_LAT * Math.cos(absLat * D2R));
    return { west: b.getWest() - west / perLng, east: b.getEast() + east / perLng, south: b.getSouth() - south / M_PER_DEG_LAT, north: b.getNorth() + north / M_PER_DEG_LAT };
  }

  dispose() {
    for (const u of this.unsubs) u();
    clearTimeout(this.timer);
  }
}
