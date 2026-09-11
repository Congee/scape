import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// Vite pre-bundles maplibre-gl but not its module worker; hand MapLibre a bundled copy.
setWorkerUrl(workerUrl);
