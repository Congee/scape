import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Badges } from '@ui/Badges';
import { DateBar } from '@ui/DateBar';
import { Panel } from '@ui/Panel';
import { AltitudeChart } from '@ui/chart/AltitudeChart';
import { BodyStrip } from '@ui/viewfinder/BodyStrip';
import { Viewfinder } from '@ui/viewfinder/Viewfinder';
import { ViewTools } from '@ui/viewfinder/ViewTools';

export const Route = createFileRoute('/viewfinder')({ component: ViewfinderPage });

function ViewfinderPage() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) void navigate({ to: '/' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  return (
    <div className="vf-page">
      <header className="topbar">
        <Link to="/" className="button-link" title="Back to the map (Esc)">
          <button className="exit">← Map</button>
        </Link>
        <DateBar />
        <Badges />
      </header>
      <BodyStrip />
      <div className="vf-area">
        <Viewfinder />
      </div>
      <div className="chart-wrap">
        <AltitudeChart />
      </div>
      <aside className="panel vf-panel">
        <ViewTools />
        <Panel />
      </aside>
    </div>
  );
}
