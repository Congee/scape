import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { worldStore } from '@state/world';
import { Badges } from '@ui/Badges';
import { DateBar } from '@ui/DateBar';
import { Panel } from '@ui/Panel';
import { Search } from '@ui/Search';
import { AltitudeChart } from '@ui/chart/AltitudeChart';
import { MapView } from '@ui/map/MapView';

interface MapSearch {
  lat?: number;
  lng?: number;
  z?: number;
  lat2?: number;
  lng2?: number;
  /** ISO instant, minute precision. */
  t?: string;
  tz?: string;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const Route = createFileRoute('/')({
  validateSearch: (raw: Record<string, unknown>): MapSearch => ({
    lat: num(raw.lat),
    lng: num(raw.lng),
    z: num(raw.z),
    lat2: num(raw.lat2),
    lng2: num(raw.lng2),
    t: str(raw.t),
    tz: str(raw.tz)
  }),
  component: MapPage
});

const round = (n: number, d: number) => Number(n.toFixed(d));

function MapPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // URL → store, once on entry.
  useEffect(() => {
    const w = worldStore.getState();
    if (search.lat != null && search.lng != null && Math.abs(search.lat) <= 90 && Math.abs(search.lng) <= 180) {
      const p = { lat: search.lat, lng: search.lng };
      w.setPin(p);
      w.flyTo(p, search.z ?? w.view.zoom, false);
    }
    if (search.lat2 != null && search.lng2 != null && Math.abs(search.lat2) <= 90 && Math.abs(search.lng2) <= 180) w.setPin2({ lat: search.lat2, lng: search.lng2 });
    if (search.tz) w.setTz(search.tz);
    if (search.t) {
      const ms = Date.parse(search.t);
      if (Number.isFinite(ms)) w.setTime(ms);
    }
    // oxlint-disable-next-line react/exhaustive-deps -- entry-time only
  }, []);

  // store → URL, debounced; replaces history so scrubbing does not spam it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const push = () => {
      const w = worldStore.getState();
      void navigate({
        to: '/',
        replace: true,
        search: {
          lat: round(w.pin.lat, 5),
          lng: round(w.pin.lng, 5),
          z: round(w.view.zoom, 2),
          lat2: w.pin2 ? round(w.pin2.lat, 5) : undefined,
          lng2: w.pin2 ? round(w.pin2.lng, 5) : undefined,
          t: w.live ? undefined : new Date(w.time).toISOString().slice(0, 16) + 'Z',
          tz: w.tzAuto ? undefined : w.tz
        }
      });
    };
    const unsub = worldStore.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(push, 500);
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [navigate]);

  return (
    <div className="map-page">
      <header className="topbar">
        <Search />
        <DateBar />
      </header>
      <div className="map-area">
        <MapView />
        <div className="map-badges">
          <Badges />
        </div>
      </div>
      <div className="chart-wrap">
        <AltitudeChart />
      </div>
      <aside className="panel">
        <Panel />
      </aside>
    </div>
  );
}
