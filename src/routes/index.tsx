import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { validateScene, type SceneSearch } from '@state/urlState';
import { offlineStore } from '@state/offline';
import { Badges } from '@ui/Badges';
import { CloudLegend } from '@ui/CloudLayerControls';
import { MapLegend } from '@ui/map/MapLegend';
import { MapNotice } from '@ui/map/MapNotice';
import { DateBar } from '@ui/DateBar';
import { Panel, PanelExpand, usePanelClass } from '@ui/Panel';
import { Search } from '@ui/Search';
import { useSceneUrl } from '@ui/sceneUrl';
import { AltitudeChart } from '@ui/chart/AltitudeChart';
import { MapView } from '@ui/map/MapView';

export const Route = createFileRoute('/')({
  validateSearch: (raw: Record<string, unknown>): SceneSearch => validateScene(raw),
  component: MapPage
});

function MapPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  useSceneUrl('/', search, true);

  // Drawing a region starts in Settings; finishing or cancelling it goes back there.
  useEffect(
    () =>
      offlineStore.subscribe((s) => s.drawing, (on) => {
        if (!on) void navigate({ to: '/settings', hash: 'offline' });
      }),
    [navigate]
  );

  return (
    <div className={usePanelClass('map-page')}>
      <header className="topbar">
        <Search />
        <DateBar />
      </header>
      <div className="map-area">
        <MapView />
        <PanelExpand />
        {/* One stack, so legends never overlap. */}
        <div className="map-legends">
          <CloudLegend />
          <MapLegend />
        </div>
        <MapNotice />
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
