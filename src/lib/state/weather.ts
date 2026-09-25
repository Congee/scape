import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { CloudLayer } from '@core/weather/layer';
import { WeatherModel } from '@core/weather/models';

export { CloudLayer };

export interface WeatherState {
  model: WeatherModel;
  layer: CloudLayer;
  opacity: number;
  setModel(model: WeatherModel): void;
  setLayer(layer: CloudLayer): void;
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

export const weatherStore = create<WeatherState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        model: WeatherModel.BestMatch,
        layer: CloudLayer.Off,
        opacity: 0.7,
        setModel: (model) => set({ model }),
        setLayer: (layer) => set({ layer }),
        setOpacity: (opacity) => set({ opacity }),
        cloudInfo: null,
        setCloudInfo: (cloudInfo) => set({ cloudInfo })
      }),
      { name: 'scape.weather', partialize: ({ model, layer, opacity }) => ({ model, layer, opacity }) }
    )
  )
);

export const useWeather = weatherStore;
