import { fileURLToPath, URL } from 'node:url';
import babel from '@rolldown/plugin-babel';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { swCachePattern } from './src/lib/core/tiles/satellite.ts';

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

// Serialized into the generated worker, so it must be self-contained: no outer references.
const TILE_URLS = /^https:\/\/(tiles\.openfreemap\.org|tile\.openstreetmap\.org|[abc]\.tile\.opentopomap\.org|s3\.amazonaws\.com|gibs\.earthdata\.nasa\.gov|protomaps\.github\.io)\//;
// Esri is excluded: its terms forbid caching.
const SAT_URLS = new RegExp(swCachePattern());

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Scape',
        short_name: 'Scape',
        description: 'Plan outdoor photography around sun, moon and stars. Works offline.',
        theme_color: '#0f1216',
        background_color: '#0f1216',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,bin,jpg,json}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Only CH/JP tiles need Draco; it is cached when first fetched instead.
        globIgnores: ['**/draco*'],
        runtimeCaching: [
          {
            urlPattern: TILE_URLS,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tiles',
              expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 60 * 24 * 120 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: SAT_URLS,
            handler: 'CacheFirst',
            options: {
              cacheName: 'satellite',
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          { urlPattern: /\/assets\/draco[^/]*\.(?:js|wasm)$/, handler: 'CacheFirst', options: { cacheName: 'draco', expiration: { maxEntries: 8 } } }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  resolve: {
    alias: {
      '@core': src('lib/core'),
      '@data': src('lib/data'),
      '@state': src('lib/state'),
      '@ui': src('lib/ui'),
      '@workers': src('lib/workers')
    }
  },
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'], environment: 'node' }
});
