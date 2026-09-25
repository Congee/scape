import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { WeatherModel } from '@core/weather/models';

/** What the map's cloud overlay shows. */
export const CloudLayer = { Off: 'Off', Total: 'Total', Low: 'Low', Mid: 'Mid', High: 'High', Fog: 'Fog' } as const;
export type CloudLayer = (typeof CloudLayer)[keyof typeof CloudLayer];

export interface WeatherState {
  model: WeatherModel;
  layer: CloudLayer;
  opacity: number;
  setModel(model: WeatherModel): void;
  setLayer(layer: CloudLayer): void;
  setOpacity(opacity: number): void;
}

export const weatherStore = create<WeatherState>()(
  persist(
    (set) => ({
      model: WeatherModel.BestMatch,
      layer: CloudLayer.Off,
      opacity: 0.7,
      setModel: (model) => set({ model }),
      setLayer: (layer) => set({ layer }),
      setOpacity: (opacity) => set({ opacity })
    }),
    { name: 'scape.weather', partialize: ({ model, layer, opacity }) => ({ model, layer, opacity }) }
  )
);

export const useWeather = weatherStore;
