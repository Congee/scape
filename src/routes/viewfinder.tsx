import { createFileRoute } from '@tanstack/react-router';
import { compositionStore, useComposition } from '@state/composition';
import { Badges } from '@ui/Badges';
import { DateBar } from '@ui/DateBar';
import { FramePanel } from '@ui/FramePanel';
import { AltitudeChart } from '@ui/chart/AltitudeChart';
import { Viewfinder } from '@ui/viewfinder/Viewfinder';

export const Route = createFileRoute('/viewfinder')({ component: ViewfinderPage });

function ViewfinderPage() {
  const showGrid = useComposition((s) => s.showGrid);
  const showMarkers = useComposition((s) => s.showMarkers);
  const showPaths = useComposition((s) => s.showPaths);
  const update = compositionStore.getState().update;
  return (
    <div className="vf-page">
      <header className="topbar">
        <DateBar />
        <Badges />
      </header>
      <div className="vf-area">
        <Viewfinder />
      </div>
      <div className="chart-wrap">
        <AltitudeChart />
      </div>
      <aside className="panel">
        <div className="panel-inner">
          <div className="tab-body">
            <div className="frame">
              <h3>Viewfinder</h3>
              <label className="toggle">
                <input type="checkbox" checked={showPaths} onChange={(e) => update({ showPaths: e.target.checked })} />
                <span>Sun, moon and Galactic Centre paths for the day</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={showMarkers} onChange={(e) => update({ showMarkers: e.target.checked })} />
                <span>Markers</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={showGrid} onChange={(e) => update({ showGrid: e.target.checked })} />
                <span>Rule-of-thirds grid</span>
              </label>
              <p className="muted hint">Drag to aim, scroll to zoom, double-click a point to centre it. The terrain is swept from the DEM at the frame's resolution; the paths dim where a body is behind the skyline.</p>
            </div>
            <FramePanel />
          </div>
        </div>
      </aside>
    </div>
  );
}
