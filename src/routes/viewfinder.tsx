import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AimLock, compositionStore } from '@state/composition';
import { orientationFor, parseInstant, parsePoint, teleconvertersFor, validateScene, viewfinderSearchFor, type SceneSearch } from '@state/urlState';
import { PanelPage } from '@state/ui';
import { worldStore } from '@state/world';
import { Badges } from '@ui/Badges';
import { DateBar } from '@ui/DateBar';
import { Panel, PanelExpand, usePanelClass } from '@ui/Panel';
import { AltitudeChart } from '@ui/chart/AltitudeChart';
import { BodyStrip } from '@ui/viewfinder/BodyStrip';
import { Viewfinder } from '@ui/viewfinder/Viewfinder';

export const Route = createFileRoute('/viewfinder')({
  validateSearch: (raw: Record<string, unknown>): SceneSearch => validateScene(raw),
  component: ViewfinderPage
});

function ViewfinderPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  // URL → stores, once on entry.
  useEffect(() => {
    const w = worldStore.getState();
    const camera = parsePoint(search.camera);
    // No map here, so move the stored view instead of flying: the map opens on the camera location later.
    if (camera) {
      w.setPin(camera);
      w.setView({ center: camera, zoom: w.view.zoom });
    }
    const target = parsePoint(search.target);
    if (target) w.setPin2(target);
    if (search.tz) w.setTz(search.tz);
    const ms = parseInstant(search.t);
    if (ms != null) w.setTime(ms);
    // An in-app visit carries no framing, so it must not reset the orientation.
    if (search.f != null || search.camera) compositionStore.getState().update({ ...(search.f != null && { focalMm: search.f }), teleconverters: teleconvertersFor(search.tc), orientation: orientationFor(search.o) });
    // Map or viewfinder drags free the aim; entering the viewfinder should face the target again, but keep a body lock.
    if (worldStore.getState().pin2 && compositionStore.getState().aimLock === AimLock.Free) compositionStore.setState({ aimLock: AimLock.Target });
    // oxlint-disable-next-line react/exhaustive-deps -- entry-time only
  }, []);

  // stores → URL, debounced; replaces history so scrubbing does not spam it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = '';
    const searchNow = () => viewfinderSearchFor(worldStore.getState(), compositionStore.getState());
    const push = () => void navigate({ to: '/viewfinder', replace: true, search: searchNow() });
    const bump = () => {
      // The live clock ticks every second but a live URL carries no time.
      const key = JSON.stringify(searchNow());
      if (key === last) return;
      last = key;
      clearTimeout(timer);
      timer = setTimeout(push, 500);
    };
    const unsubs = [worldStore.subscribe(bump), compositionStore.subscribe(bump)];
    // An in-app visit arrives without params; write them so the address bar is always shareable.
    bump();
    return () => {
      for (const u of unsubs) u();
      clearTimeout(timer);
    };
  }, [navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) void navigate({ to: '/' });
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
