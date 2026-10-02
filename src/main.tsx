import 'maplibre-gl/dist/maplibre-gl.css';
import './app.css';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startAimFollow } from '@state/aimLock';
import { alignStore, startAlignSync } from '@state/align';
import { buildingsStore, requestBuildings, shadowMaskPending } from '@state/buildings';
import { lod2Store } from '@state/lod2';
import { startClock } from '@state/clock';
import { compositionStore } from '@state/composition';
import { startCrossTabSync } from '@state/crossTab';
import { dayDataStore, startDayDataSync } from '@state/dayData';
import { finderStore } from '@state/finder';
import { gearStore } from '@state/gear';
import { lightProbeStore } from '@state/lightProbe';
import { skyglowStore, startSkyglowSync } from '@state/skyglow';
import { mapStatusStore } from '@state/mapStatus';
import { markersStore } from '@state/markers';
import { modelsStore, startModelsSync } from '@state/models';
import { offlineStore, startGeoidSync, startOffline } from '@state/offline';
import { plansStore } from '@state/plans';
import { searchesStore } from '@state/searches';
import { stringifySearch } from '@state/searchCodec';
import { settingsStore } from '@state/settings';
import { skyStore } from '@state/sky';
import { startTerrainSync, terrainStore } from '@state/terrain';
import { uiStore } from '@state/ui';
import { installIdleProbe } from '@ui/idleProbe';
import { worldStore } from '@state/world';
import { weatherStore } from '@state/weather';
import { glowStats } from '@data/alpenglow';
import { weatherStats } from '@data/weather';
import { cloudStats } from '@ui/map/cloudOverlay';
import { parkedAt } from '@ui/viewfinder/parkedScene';
import { routeTree } from './routeTree.gen';

const router = createRouter({ routeTree, defaultPreload: 'intent', stringifySearch });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// The `probe` build is production code with the debug handles the idle harness reads.
if (import.meta.env.DEV || import.meta.env.MODE === 'probe') {
  window.addEventListener('error', (e) => console.error('[scape] error:', e.message, e.filename, e.lineno, e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => console.error('[scape] rejection:', e.reason));
  (window as unknown as { __scape?: unknown }).__scape = { world: worldStore, settings: settingsStore, terrain: terrainStore, composition: compositionStore, markers: markersStore, models: modelsStore, plans: plansStore, gear: gearStore, sky: skyStore, dayData: dayDataStore, finder: finderStore, align: alignStore, searches: searchesStore, offline: offlineStore, buildings: buildingsStore, lod2: lod2Store, vfPark: parkedAt, lightProbe: lightProbeStore, mapStatus: mapStatusStore, skyglow: skyglowStore, ui: uiStore, weather: weatherStore, weatherStats, glowStats, cloudStats, shadowPending: shadowMaskPending, idle: installIdleProbe() };
  (window as unknown as Record<string, unknown>)['__scapeRequestBuildings'] = requestBuildings;
}

await startOffline();

startCrossTabSync();
startTerrainSync();
startAlignSync();
startDayDataSync();
startClock();
startAimFollow();
startModelsSync();
startGeoidSync();
startSkyglowSync();
void markersStore.getState().load();
void modelsStore.getState().load();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
