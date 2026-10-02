import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AimLock, compositionStore } from '@state/composition';
import { isWholeScene, validateScene, type SceneSearch } from '@state/urlState';
import { PanelPage } from '@state/ui';
import { worldStore } from '@state/world';
import { Badges } from '@ui/Badges';
import { DateBar } from '@ui/DateBar';
import { Panel, PanelExpand, usePanelClass } from '@ui/Panel';
import { AltitudeChart } from '@ui/chart/AltitudeChart';
import { sceneSearchNow, useSceneUrl } from '@ui/sceneUrl';
import { BodyStrip } from '@ui/viewfinder/BodyStrip';
import { Viewfinder } from '@ui/viewfinder/Viewfinder';

export const Route = createFileRoute('/viewfinder')({
  validateSearch: (raw: Record<string, unknown>): SceneSearch => validateScene(raw),
  component: ViewfinderPage
});

function ViewfinderPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  // A bare visit faces the target again after a map drag freed the aim; a sky-body lock stays.
  useEffect(() => {
    if (!isWholeScene(search) && worldStore.getState().pin2 && compositionStore.getState().aimLock === AimLock.Free) compositionStore.setState({ aimLock: AimLock.Target });
    // oxlint-disable-next-line react/exhaustive-deps -- entry-time only
  }, []);
  useSceneUrl('/viewfinder', search, false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) void navigate({ to: '/', search: sceneSearchNow() });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
  return (
    <div className={usePanelClass('vf-page')}>
      <header className="topbar">
        <DateBar />
        <Badges />
      </header>
      <BodyStrip />
      <div className="vf-area">
        <Viewfinder />
        <PanelExpand />
      </div>
      <div className="chart-wrap">
        <AltitudeChart />
      </div>
      <aside className="panel">
        <Panel page={PanelPage.Viewfinder} />
      </aside>
    </div>
  );
}
