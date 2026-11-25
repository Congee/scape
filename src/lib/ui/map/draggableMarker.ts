import { Marker, type Map as MaplibreMap } from 'maplibre-gl';
import { atPixel } from '@core/geo/coords';
import type { LngLat } from '@core/geo/geodesy';

export interface MarkerOpts {
  at: LngLat;
  color?: string;
  scale?: number;
  element?: HTMLElement;
}

/** Draggable marker whose drags reach the store at most once per frame; `cancel` drops a pending one. */
export function draggableMarker(map: MaplibreMap, opts: MarkerOpts, commit: (p: LngLat, final: boolean) => void, setDragging: (d: boolean) => void) {
  const m = new Marker({ draggable: true, color: opts.color, scale: opts.scale, element: opts.element }).setLngLat([opts.at.lng, opts.at.lat]).addTo(map);
  let raf = 0;
  const commitPos = (final: boolean) => {
    commit(atPixel(m.getLngLat(), map.getZoom()), final);
  };
  m.on('dragstart', () => setDragging(true));
  m.on('drag', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      commitPos(false);
    });
  });
  m.on('dragend', () => {
    cancelAnimationFrame(raf);
    raf = 0;
    setDragging(false);
    commitPos(true);
  });
  return { marker: m, cancel: () => cancelAnimationFrame(raf) };
}
