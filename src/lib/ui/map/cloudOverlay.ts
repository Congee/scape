import type { ImageSource, Map as MaplibreMap } from 'maplibre-gl';
import { shallow } from 'zustand/shallow';
import { cellPoints, lattice, latticeCorners, paintLattice, type Lattice } from '@core/weather/grid';
import { CloudLayer, gapColor, layerColor, layerValue } from '@core/weather/layer';
import { modelInfo } from '@core/weather/models';
import { CLOUD_VARS, type PointSeries } from '@core/weather/openMeteo';
import { forecastPoints } from '@data/weather';
import { weatherStore } from '@state/weather';
import { worldStore } from '@state/world';

const SRC = 'weather-cloud';
const LAYER = 'weather-cloud';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Pan/zoom must rest this long before the lattice is refetched. */
export const SETTLE_MS = 500;
const PX_PER_CELL = 8;

/** Counters for smoke checks. */
export const cloudStats = { fetches: 0, paints: 0 };

/** Map cloud/fog raster from a viewport lattice; fetches only after the map settles, repaints only on hour, layer or data change. */
export class CloudOverlay {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;
  private lattice: Lattice | null = null;
  private series: (PointSeries | null)[] = [];
  private dataKey = '';
  private painted = '';
  private unsubs: (() => void)[];

  constructor(private map: MaplibreMap) {
    const onMove = () => this.schedule();
    map.on('moveend', onMove);
    this.unsubs = [
      () => map.off('moveend', onMove),
      () => clearTimeout(this.timer),
      weatherStore.subscribe((s) => [s.layer, s.model] as const, () => this.fetch(), { equalityFn: shallow }),
      weatherStore.subscribe((s) => s.opacity, () => this.applyOpacity()),
      worldStore.subscribe(
        (s) => Math.round(s.time / HOUR_MS),
        () => {
          if (weatherStore.getState().layer === CloudLayer.Off) return;
          if (this.dayOf(worldStore.getState().time) === this.dataKey.split('|')[1]) this.paint();
          else this.fetch();
        }
      )
    ];
  }

  /** Called on every style load; the source goes under the first symbol layer. */
  addLayer(beforeId: string | undefined) {
    if (this.map.getSource(SRC)) return;
    this.map.addSource(SRC, { type: 'image', coordinates: [[-1, 1], [1, 1], [1, -1], [-1, -1]] });
    this.map.addLayer(
      {
        id: LAYER,
        type: 'raster',
        source: SRC,
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': weatherStore.getState().opacity, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }
      },
      beforeId
    );
    this.painted = '';
    if (this.lattice) this.paint();
    else this.fetch();
  }

  dispose() {
    for (const u of this.unsubs) u();
  }

  private dayOf(ms: number) {
    return String(Math.floor(ms / DAY_MS) * DAY_MS);
  }

  private schedule() {
    clearTimeout(this.timer);
    if (weatherStore.getState().layer === CloudLayer.Off) return;
    this.timer = setTimeout(() => this.fetch(), SETTLE_MS);
  }

  private fetch() {
    clearTimeout(this.timer);
    const { layer, model } = weatherStore.getState();
    if (layer === CloudLayer.Off) {
      this.hide();
      return;
    }
    const b = this.map.getBounds();
    const l = lattice({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, modelInfo(model).minKm);
    const day = Math.floor(worldStore.getState().time / DAY_MS) * DAY_MS;
    const key = `${model}|${day}|${l.step}|${l.lng0}|${l.lat0}|${l.cols}|${l.rows}`;
    if (key === this.dataKey) return this.paint();
    const seq = ++this.seq;
    cloudStats.fetches++;
    void forecastPoints(cellPoints(l), model, CLOUD_VARS, day, day + DAY_MS).then((r) => {
      if (seq !== this.seq) return;
      this.lattice = l;
      this.series = r.map((x) => x.series);
      this.dataKey = key;
      const fetchedAt = Math.min(...r.map((x) => (x.series ? x.fetchedAt : Infinity)));
      weatherStore.getState().setCloudInfo({
        stepKm: l.step * 111.2,
        cells: r.length,
        unknown: r.filter((x) => !x.series).length,
        fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0,
        at: Date.now(),
        note: r.find((x) => x.note)?.note ?? ''
      });
      this.painted = '';
      this.paint();
    });
  }

  private paint() {
    const src = this.map.getSource(SRC) as ImageSource | undefined;
    const { layer } = weatherStore.getState();
    if (!src || !this.lattice || layer === CloudLayer.Off) return;
    const hour = Math.round(worldStore.getState().time / HOUR_MS) * HOUR_MS;
    const key = `${this.dataKey}|${layer}|${hour}`;
    if (key === this.painted) return;
    this.painted = key;
    cloudStats.paints++;
    const values = this.series.map((s) => layerValue(layer, s, hour));
    const img = paintLattice(this.lattice, values, PX_PER_CELL, (v) => layerColor(layer, v), gapColor);
    src.updateImage({ image: new ImageData(img.data, img.width, img.height), coordinates: latticeCorners(this.lattice) });
    this.applyOpacity();
    this.map.setLayoutProperty(LAYER, 'visibility', 'visible');
  }

  private applyOpacity() {
    if (this.map.getLayer(LAYER)) this.map.setPaintProperty(LAYER, 'raster-opacity', weatherStore.getState().opacity);
  }

  private hide() {
    this.seq++;
    this.dataKey = '';
    this.painted = '';
    weatherStore.getState().setCloudInfo(null);
    if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, 'visibility', 'none');
  }
}
