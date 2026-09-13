import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { mapSearchFor, parseInstant, parsePoint, validateScene, type SceneSearch } from '@state/urlState';
import { worldStore } from '@state/world';
import { Badges } from '@ui/Badges';
import { DateBar } from '@ui/DateBar';
import { Panel, PanelExpand, usePanelClass } from '@ui/Panel';
import { Search } from '@ui/Search';
import { AltitudeChart } from '@ui/chart/AltitudeChart';
import { MapView } from '@ui/map/MapView';

export const Route = createFileRoute('/')({
  validateSearch: (raw: Record<string, unknown>): SceneSearch => validateScene(raw),
  component: MapPage
});

function MapPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // URL → store, once on entry.
  useEffect(() => {
    const w = worldStore.getState();
    const camera = parsePoint(search.camera);
    if (camera) {
      w.setPin(camera);
      w.flyTo(camera, search.z ?? w.view.zoom, false);
    }
    const target = parsePoint(search.target);
    if (target) w.setPin2(target);
    if (search.tz) w.setTz(search.tz);
    const ms = parseInstant(search.t);
    if (ms != null) w.setTime(ms);
    // oxlint-disable-next-line react/exhaustive-deps -- entry-time only
  }, []);

  // store → URL, debounced; replaces history so scrubbing does not spam it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const push = () => {
      const w = worldStore.getState();
      void navigate({ to: '/', replace: true, search: mapSearchFor(w, w.view.zoom) });
    };
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(push, 500);
    };
    const unsub = worldStore.subscribe(bump);
    // The entry effect above has already run, so normalise whatever the address bar carries.
    bump();
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [navigate]);

  return (
    <div className={usePanelClass('map-page')}>
      <header className="topbar">
        <Search />
        <DateBar />
      </header>
      <div className="map-area">
        <MapView />
        <PanelExpand />
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
