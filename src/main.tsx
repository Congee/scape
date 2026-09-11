import 'maplibre-gl/dist/maplibre-gl.css';
import './app.css';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startClock } from '@state/clock';
import { startDayDataSync } from '@state/dayData';
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
}

startDayDataSync();
startClock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
