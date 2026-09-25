import { useEffect, useRef } from 'react';
import { MapController } from './MapController';
import { MapLegend } from './MapLegend';

export function MapView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new MapController(ref.current!);
    return () => controller.dispose();
  }, []);
  return (
    <>
      <div ref={ref} className="map" />
      <MapLegend />
    </>
  );
}
