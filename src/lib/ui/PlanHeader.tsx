import { makeObserver, SkyBody } from '@core/astro/bodies';
import { position } from '@core/astro/positions';
import { height } from '@core/format';
import { formatLngLat } from '@core/geo/coords';
import { formatDate, formatTime } from '@core/time/format';
import { useDayData } from '@state/dayData';
import { libraryStore, useLibrary } from '@state/library';
import { useSettings } from '@state/settings';
import { usePinSiteHeightM, useTerrain } from '@state/terrain';
import { useWorld } from '@state/world';
import { useEffect } from 'react';
import { phaseLightness, phaseStep } from './dayPhase';

// A saved spot within this many degrees of the camera names the band.
const NEAR_DEG = 0.0005;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Place and date: the saved location's name, else the coordinates. */
export function PlaceBand() {
  const pin = useWorld((s) => s.pin);
  const time = useWorld((s) => s.time);
  const tz = useWorld((s) => s.tz);
  const hour12 = useSettings((s) => s.hour12);
  const format = useSettings((s) => s.coordFormat);
  const units = useSettings((s) => s.units);
  const ground = useTerrain((s) => s.pinGroundM);
  const loaded = useLibrary((s) => s.loaded);
  const saved = useLibrary((s) => s.locations.find((l) => Math.abs(l.lat - pin.lat) < NEAR_DEG && Math.abs(l.lng - pin.lng) < NEAR_DEG)?.name);
  useEffect(() => {
    if (!loaded) void libraryStore.getState().load().catch(() => {});
  }, [loaded]);
  const coords = formatLngLat(pin, format);
  const parts = [formatDate(time, tz), formatTime(time, tz, hour12), saved ? coords : null, ground == null || Number.isNaN(ground) ? null : height(ground, units)];
  return (
    <div className="band">
      <b className="band-name">{saved ?? coords}</b>
      <small>{parts.filter(Boolean).join(' · ')}</small>
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
