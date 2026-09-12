import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { compositionStore } from '@state/composition';
import { worldStore } from '@state/world';
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
  // Map or viewfinder drags release the aim lock; entering the viewfinder should face the target again.
  useEffect(() => {
    if (worldStore.getState().pin2) compositionStore.setState({ aimAtTarget: true });
    // oxlint-disable-next-line react/exhaustive-deps -- entry-time only
  }, []);
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
