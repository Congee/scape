import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { CloudLayer } from '@core/weather/layer';
import { WeatherModel } from '@core/weather/models';

export { CloudLayer };

export interface WeatherState {
  model: WeatherModel;
  layer: CloudLayer;
  /** The layer a plain on switch brings back. */
  lastLayer: Exclude<CloudLayer, 'Off'>;
  opacity: number;
  setModel(model: WeatherModel): void;
  setLayer(layer: CloudLayer): void;
  /** Off, or back on at the last layer shown. */
  setShown(on: boolean): void;
  setOpacity(opacity: number): void;
  /** What the map overlay last drew; not persisted. */
  cloudInfo: CloudInfo | null;
  setCloudInfo(info: CloudInfo | null): void;
}

export interface CloudInfo {
  stepKm: number;
  cells: number;
  unknown: number;
  fetchedAt: number;
  /** When this was drawn; ages are frozen here. */
  at: number;
  note: string;
}

type Persisted = Partial<Pick<WeatherState, 'model' | 'layer' | 'lastLayer' | 'opacity'>>;

/** State saved before `lastLayer` existed brings back the layer it had on. */
export function mergeWeather(saved: unknown, current: WeatherState): WeatherState {
  const p = (saved ?? {}) as Persisted;
  const lastLayer = p.lastLayer ?? (p.layer && p.layer !== CloudLayer.Off ? p.layer : current.lastLayer);
  return { ...current, ...p, lastLayer };
}

export const weatherStore = create<WeatherState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        model: WeatherModel.BestMatch,
        layer: CloudLayer.Off,
        lastLayer: CloudLayer.Total,
        opacity: 0.7,
        setModel: (model) => set({ model }),
        setLayer: (layer) => set(layer === CloudLayer.Off ? { layer } : { layer, lastLayer: layer }),
        setShown: (on) => set((s) => ({ layer: on ? s.lastLayer : CloudLayer.Off })),
        setOpacity: (opacity) => set({ opacity }),
        cloudInfo: null,
        setCloudInfo: (cloudInfo) => set({ cloudInfo })
      }),
      { name: 'scape.weather', partialize: ({ model, layer, lastLayer, opacity }) => ({ model, layer, lastLayer, opacity }), merge: mergeWeather }
    )
  )
);

export const useWeather = weatherStore;
