import { describe, expect, it } from 'vitest';
import { CloudLayer, mergeWeather, weatherStore } from './weather';

describe('weather layer switch', () => {
  it('turns back on at the last layer shown', () => {
    const w = weatherStore.getState();
    w.setLayer(CloudLayer.Fog);
    w.setShown(false);
    expect(weatherStore.getState().layer).toBe(CloudLayer.Off);
    weatherStore.getState().setShown(true);
    expect(weatherStore.getState().layer).toBe(CloudLayer.Fog);
  });

  it('brings back the layer saved before lastLayer existed', () => {
    const cur = weatherStore.getState();
    expect(mergeWeather({ layer: CloudLayer.Low }, cur).lastLayer).toBe(CloudLayer.Low);
    expect(mergeWeather({ layer: CloudLayer.Off }, { ...cur, lastLayer: CloudLayer.Total }).lastLayer).toBe(CloudLayer.Total);
    expect(mergeWeather({ layer: CloudLayer.Off, lastLayer: CloudLayer.High }, cur).lastLayer).toBe(CloudLayer.High);
  });
});
