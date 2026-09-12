import 'maplibre-gl/dist/maplibre-gl.css';
import './app.css';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startClock } from '@state/clock';
import { compositionStore } from '@state/composition';
import { dayDataStore, startDayDataSync } from '@state/dayData';
import { gearStore } from '@state/gear';
import { markersStore } from '@state/markers';
import { plansStore } from '@state/plans';
import { settingsStore } from '@state/settings';
import { skyStore } from '@state/sky';
import { startTerrainSync, terrainStore } from '@state/terrain';
import { worldStore } from '@state/world';
import { routeTree } from './routeTree.gen';

const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

if (import.meta.env.DEV) {
  window.addEventListener('error', (e) => console.error('[scape] error:', e.message, e.filename, e.lineno, e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => console.error('[scape] rejection:', e.reason));
  (window as unknown as { __scape?: unknown }).__scape = { world: worldStore, settings: settingsStore, terrain: terrainStore, composition: compositionStore, markers: markersStore, plans: plansStore, gear: gearStore, sky: skyStore, dayData: dayDataStore };
}

startTerrainSync();
startDayDataSync();
startClock();
void markersStore.getState().load();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
