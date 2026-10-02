import type { LngLat } from '@core/geo/geodesy';
import { libraryStore, useLibrary } from '@state/library';
import { useWorld } from '@state/world';
import { useEffect } from 'react';

// A saved spot within this many degrees of the camera names the band.
const NEAR_DEG = 0.0005;

/** Name of the saved location at `p`, if any. */
export function useSavedName(p: LngLat | null): string | undefined {
  const loaded = useLibrary((s) => s.loaded);
  const name = useLibrary((s) => (p ? s.locations.find((l) => Math.abs(l.lat - p.lat) < NEAR_DEG && Math.abs(l.lng - p.lng) < NEAR_DEG)?.name : undefined));
  useEffect(() => {
    if (!loaded) void libraryStore.getState().load().catch(() => {});
  }, [loaded]);
  return name;
}

/** Place: the saved location's name; no band for an unnamed spot, since the badges show coordinates and elevation. */
export function PlaceBand() {
  const pin = useWorld((s) => s.pin);
  const saved = useSavedName(pin);
  if (!saved) return null;
  return (
    <div className="band">
      <b className="band-name">{saved}</b>
    </div>
  );
}
