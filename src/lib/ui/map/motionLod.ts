// oxlint-disable no-underscore-dangle -- MapLibre style internals
import type { Map as MaplibreMap, MapLibreEvent } from 'maplibre-gl';

/** Canvas width, CSS px, from which a moving map drops detail. */
export const MOTION_LOD_MIN_WIDTH = 2500;
/** Quiet time after moveend before detail returns, so a stream of wheel ticks does not flip it each tick. */
export const MOTION_LOD_RESTORE_MS = 120;
/** Vector tile size while moving: tiles one zoom coarser. */
const COARSE_TILE_SIZE = 1024;

/** Low-value non-symbol basemap layers hidden while moving: OpenFreeMap styles and every Protomaps flavor. */
export const MOTION_HIDDEN_LAYERS: readonly string[] = [
  'aeroway-area', 'aeroway-runway', 'aeroway-runway-casing', 'aeroway-taxiway', 'aeroway-taxiway-casing', 'aeroway_fill', 'aeroway_runway', 'aeroway_taxiway',
  'boundary_3', 'boundary_state',
  'bridge-link-casing', 'bridge-minor', 'bridge-minor-casing', 'bridge-motorway-casing', 'bridge-motorway-link-casing', 'bridge-path', 'bridge-path-casing',
  'bridge-railway-hatching', 'bridge-secondary-tertiary-casing', 'bridge-trunk-primary-casing', 'bridge_link_casing', 'bridge_major_rail_hatching',
  'bridge_motorway_casing', 'bridge_motorway_link_casing', 'bridge_path_pedestrian', 'bridge_path_pedestrian_casing', 'bridge_secondary_tertiary_casing',
  'bridge_service_track', 'bridge_service_track_casing', 'bridge_street', 'bridge_street_casing', 'bridge_transit_rail', 'bridge_transit_rail_hatching',
  'bridge_trunk_primary_casing',
  'cablecar', 'cablecar-dash', 'ferry',
  'highway-area', 'highway-link-casing', 'highway-minor', 'highway-minor-casing', 'highway-motorway-casing', 'highway-motorway-link-casing', 'highway-path',
  'highway-primary-casing', 'highway-secondary-tertiary-casing', 'highway-trunk-casing', 'highway_major_casing', 'highway_minor',
  'highway_motorway_bridge_casing', 'highway_motorway_casing', 'highway_path',
  'landcover-glacier', 'landcover-grass', 'landcover-grass-park', 'landcover-ice-shelf', 'landcover-sand', 'landcover-wood', 'landcover_glacier',
  'landcover_grass', 'landcover_ice', 'landcover_ice_shelf', 'landcover_sand', 'landcover_wetland', 'landcover_wood',
  'landuse-cemetery', 'landuse-commercial', 'landuse-hospital', 'landuse-industrial', 'landuse-railway', 'landuse-residential', 'landuse-school',
  'landuse-suburb', 'landuse_aerodrome', 'landuse_beach', 'landuse_cemetery', 'landuse_hospital', 'landuse_industrial', 'landuse_pedestrian', 'landuse_pier',
  'landuse_pitch', 'landuse_residential', 'landuse_runway', 'landuse_school', 'landuse_track', 'landuse_urban_green', 'landuse_zoo',
  'park_outline',
  'railway-hatching', 'railway-service', 'railway-service-hatching', 'railway-transit', 'railway-transit-hatching', 'railway_dashline', 'railway_minor',
  'railway_minor_dashline', 'railway_service', 'railway_service_dashline', 'railway_transit', 'railway_transit_dashline',
  'road_area_pattern', 'road_area_pier', 'road_link_casing', 'road_major_rail_hatching', 'road_minor', 'road_minor_casing', 'road_motorway_casing',
  'road_motorway_link_casing', 'road_path_pedestrian', 'road_pier', 'road_secondary_tertiary_casing', 'road_service_track', 'road_service_track_casing',
  'road_transit_rail', 'road_transit_rail_hatching', 'road_trunk_primary_casing',
  'roads_bridges_highway_casing', 'roads_bridges_link_casing', 'roads_bridges_major_casing', 'roads_bridges_minor', 'roads_bridges_minor_casing',
  'roads_bridges_other', 'roads_bridges_other_casing', 'roads_highway_casing_early', 'roads_highway_casing_late', 'roads_link_casing',
  'roads_major_casing_early', 'roads_major_casing_late', 'roads_minor', 'roads_minor_casing', 'roads_minor_service', 'roads_minor_service_casing',
  'roads_other', 'roads_pier', 'roads_runway', 'roads_taxiway', 'roads_tunnels_highway', 'roads_tunnels_highway_casing', 'roads_tunnels_link',
  'roads_tunnels_link_casing', 'roads_tunnels_major', 'roads_tunnels_major_casing', 'roads_tunnels_minor', 'roads_tunnels_minor_casing',
  'roads_tunnels_other', 'roads_tunnels_other_casing',
  'tunnel-link', 'tunnel-link-casing', 'tunnel-minor', 'tunnel-minor-casing', 'tunnel-motorway', 'tunnel-motorway-casing', 'tunnel-motorway-link',
  'tunnel-motorway-link-casing', 'tunnel-path', 'tunnel-railway', 'tunnel-secondary-tertiary', 'tunnel-secondary-tertiary-casing', 'tunnel-service-track',
  'tunnel-service-track-casing', 'tunnel-trunk-primary', 'tunnel-trunk-primary-casing', 'tunnel_link', 'tunnel_link_casing', 'tunnel_major_rail',
  'tunnel_major_rail_hatching', 'tunnel_minor', 'tunnel_motorway', 'tunnel_motorway_casing', 'tunnel_motorway_inner', 'tunnel_motorway_link',
  'tunnel_motorway_link_casing', 'tunnel_path_pedestrian', 'tunnel_secondary_tertiary', 'tunnel_secondary_tertiary_casing', 'tunnel_service_track',
  'tunnel_service_track_casing', 'tunnel_street_casing', 'tunnel_transit_rail', 'tunnel_transit_rail_hatching', 'tunnel_trunk_primary',
  'tunnel_trunk_primary_casing',
  'waterway-other', 'waterway-other-intermittent', 'waterway-stream-canal', 'waterway-stream-canal-intermittent', 'waterway_other', 'waterway_tunnel'
];

/** Whether a movestart drops detail: user-driven, on a big canvas. */
export function motionLodWanted(canvasWidth: number, userDriven: boolean): boolean {
  return userDriven && canvasWidth >= MOTION_LOD_MIN_WIDTH;
}

export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** Lowers on a wanted start, raises once moves have been quiet for `delayMs`; a new start cancels a pending raise. */
export function motionSwitch(lower: () => void, raise: () => void, delayMs = MOTION_LOD_RESTORE_MS, timers: Timers = realTimers) {
  let low = false;
  let pending: unknown;
  const cancel = () => {
    if (pending === undefined) return;
    timers.clear(pending);
    pending = undefined;
  };
  return {
    get low() {
      return low;
    },
    start(wanted: boolean) {
      cancel();
      if (low || !wanted) return;
      low = true;
      lower();
    },
    end() {
      if (!low) return;
      cancel();
      pending = timers.set(() => {
        pending = undefined;
        low = false;
        raise();
      }, delayMs);
    },
    /** Raises now if low. */
    flush() {
      cancel();
      if (!low) return;
      low = false;
      raise();
    }
  };
}

type StyleLayerPrivate = { id: string; type: string; source?: string; visibility?: string; setLayoutProperty(name: 'visibility', v: 'visible' | 'none'): void };
type StylePrivate = { getLayer(id: string): StyleLayerPrivate | undefined; _serializedLayers: unknown };
type MapPrivate = { style?: StylePrivate; _update(updateStyle?: boolean): unknown };
type TiledSource = { type: string; tileSize: number };

/**
 * On a big canvas, a user-driven move hides MOTION_HIDDEN_LAYERS and loads basemap vector tiles one zoom coarser, both
 * restored once the map rests. Visibility is set on the style layers directly: map.setLayoutProperty would reparse
 * every tile and drop the tile cache, so the restore would refetch instead of reusing the fine tiles.
 */
export function installMotionLod(map: MaplibreMap): () => void {
  const mp = map as unknown as MapPrivate;
  let hidden: StyleLayerPrivate[] = [];
  let coarse: { src: TiledSource; size: number }[] = [];

  const setVisibility = (layers: StyleLayerPrivate[], v: 'visible' | 'none') => {
    for (const l of layers) l.setLayoutProperty('visibility', v);
    if (mp.style) mp.style._serializedLayers = null;
    mp._update(true);
  };
  const lower = () => {
    const style = mp.style;
    if (!style) return;
    const sources = new Set<string>();
    for (const id of MOTION_HIDDEN_LAYERS) {
      const l = style.getLayer(id);
      if (!l || l.type === 'symbol' || (l.visibility ?? 'visible') !== 'visible') continue;
      hidden.push(l);
      if (l.source) sources.add(l.source);
    }
    for (const id of sources) {
      const src = map.getSource(id) as unknown as TiledSource | undefined;
      if (src?.type !== 'vector') continue;
      coarse.push({ src, size: src.tileSize });
      src.tileSize = COARSE_TILE_SIZE;
    }
    setVisibility(hidden, 'none');
  };
  const raise = () => {
    const style = mp.style;
    // A layer another style replaced, or someone else changed since, is not ours to show.
    const mine = hidden.filter((l) => style?.getLayer(l.id) === l && l.visibility === 'none');
    for (const c of coarse) c.src.tileSize = c.size;
    hidden = [];
    coarse = [];
    setVisibility(mine, 'visible');
  };
  const sw = motionSwitch(lower, raise);

  const onStart = (e: MapLibreEvent) => sw.start(motionLodWanted(map.getCanvas().clientWidth, !!e.originalEvent));
  const onEnd = () => sw.end();
  const onStyle = () => sw.flush();
  map.on('movestart', onStart);
  map.on('moveend', onEnd);
  map.on('style.load', onStyle);
  return () => {
    map.off('movestart', onStart);
    map.off('moveend', onEnd);
    map.off('style.load', onStyle);
    sw.flush();
  };
}
