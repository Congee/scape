import { makeObserver, SkyBody } from '@core/astro/bodies';
import { position } from '@core/astro/positions';
import type { LngLat } from '@core/geo/geodesy';
import { useDayData } from '@state/dayData';
import { libraryStore, useLibrary } from '@state/library';
import { usePinSiteHeightM } from '@state/terrain';
import { useWorld } from '@state/world';
import { useEffect } from 'react';
import { phaseLightness, phaseStep } from './dayPhase';

// A saved spot within this many degrees of the camera names the band.
const NEAR_DEG = 0.0005;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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

/** The day in 24 grey steps by sun altitude, with a tick at the clock. */
export function DayStrip() {
  const pin = useWorld((s) => s.pin);
  const time = useWorld((s) => s.time);
  const siteM = usePinSiteHeightM();
  const dayStart = useDayData((s) => s.dayStart);
  const dayEnd = useDayData((s) => s.dayEnd);
  if (dayEnd <= dayStart) return null;
  const span = dayEnd - dayStart;
  const obs = makeObserver(pin, siteM);
  const cells = HOURS.map((i) => phaseStep(position(SkyBody.Sun, new Date(dayStart + ((i + 0.5) * span) / 24), obs).altitude));
  const at = (time - dayStart) / span;
  return (
    <figure className="zone" aria-hidden="true">
      <div className="zone-strip">
        {HOURS.map((h) => (
          <i key={h} style={{ background: `hsl(0 0% ${phaseLightness(cells[h])}%)` }} />
        ))}
        {at >= 0 && at <= 1 && <b className="zone-now" style={{ left: `${(at * 100).toFixed(2)}%` }} />}
      </div>
      <figcaption className="zone-axis">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h}>{h}</span>
        ))}
      </figcaption>
    </figure>
  );
}
