import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Bbox } from '@core/geo/bbox';
import { DEFAULT_BASEMAP_ID, offlineBasemaps, styleAssetUrls, type Basemap, type PmFlavor } from '@data/basemaps';
import { localBuildings, localTerrain } from '@data/localTiles';
import { announceArchives, listArchives, opfsSupported, readArchiveFile, removeArchive, writeMeta } from '@data/opfs';
import { registerArchive, unregisterArchive } from '@data/pmtiles';
import { downloadBlob } from '@ui/download';
import { ArchiveKind, RegionRequestKind, RegionResponseKind, type ArchiveMeta, type Estimate, type RegionRequest, type RegionResponse, type RegionSpec } from '@workers/region.protocol';
import { findBasemap, settingsStore } from './settings';

export { ArchiveKind, type ArchiveMeta, type Estimate, type RegionSpec } from '@workers/region.protocol';
export { defaultBasemapSourceUrl } from '@data/protomaps';

/** OPFS is read once at startup; a slow storage layer must not hold up the app. */
const LOAD_TIMEOUT_MS = 800;

export const JobState = { Estimating: 'Estimating', Running: 'Running', Done: 'Done', Error: 'Error', Cancelled: 'Cancelled' } as const;
export type JobState = (typeof JobState)[keyof typeof JobState];

export interface DownloadJob extends RegionSpec {
  id: string;
  state: JobState;
  done: number;
  total: number;
  bytes: number;
  error: string | null;
  startedAt: number;
}

export interface OfflineState {
  supported: boolean;
  loaded: boolean;
  archives: ArchiveMeta[];
  jobs: DownloadJob[];
  storage: { usage: number; quota: number; persisted: boolean } | null;
  /** Region being drawn or edited on the map. */
  draft: Bbox | null;
  drawing: boolean;
  /** Bumped to ask the map for its current bounds. */
  viewSeq: number;
  load(): Promise<void>;
  refreshStorage(): Promise<void>;
  requestPersist(): Promise<boolean>;
  setDraft(b: Bbox | null): void;
  setDrawing(on: boolean): void;
  takeMapView(): void;
  estimate(spec: RegionSpec): Promise<Estimate>;
  /** Returns the job id, which becomes the archive id. */
  download(spec: RegionSpec): string;
  cancel(jobId: string): void;
  dismiss(jobId: string): void;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  exportArchive(id: string): Promise<void>;
  importArchive(file: File, name?: string): Promise<ArchiveMeta>;
}

// --- worker plumbing ----------------------------------------------------

let worker: Worker | null = null;
const handlers = new Map<string, (res: RegionResponse) => void>();

function post(req: RegionRequest): void {
  if (!worker) {
    worker = new Worker(new URL('../workers/region.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<RegionResponse>) => handlers.get(e.data.id)?.(e.data));
  }
  worker.postMessage(req);
}

/** Fetches a style's sprites and glyphs once so the service worker holds them for offline maps. */
export function warmStyleAssets(flavor: PmFlavor): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  for (const url of styleAssetUrls(flavor)) void fetch(url).catch(() => undefined);
}

// Ids become file names; two requests in one millisecond must not collide.
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// --- store --------------------------------------------------------------

export const offlineStore = create<OfflineState>()(
  subscribeWithSelector((set, get) => {
    const patchJob = (id: string, patch: Partial<DownloadJob>) =>
      set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));

    const adopt = async (meta: ArchiveMeta, replaces?: string) => {
      registerArchive(meta);
      if (meta.kind === ArchiveKind.Basemap) warmStyleAssets(settingsStore.getState().offlineFlavor);
      if (replaces) {
        // An update must carry the selection over, or the basemap falls back to the default.
        const st = settingsStore.getState();
        if (st.basemapId === `opfs:${replaces}`) st.update({ basemapId: `opfs:${meta.id}` });
        unregisterArchive(replaces);
        await removeArchive(replaces);
      }
      set((s) => ({ archives: [...s.archives.filter((a) => a.id !== meta.id && a.id !== replaces), meta] }));
      localTerrain.refresh();
      localBuildings.refresh();
      announceArchives();
      await get().refreshStorage();
    };

    return {
      supported: opfsSupported(),
      loaded: false,
      archives: [],
      jobs: [],
      storage: null,
      draft: null,
      drawing: false,
      viewSeq: 0,

      load: async () => {
        if (!opfsSupported()) return set({ supported: false, loaded: true });
        const archives = await listArchives();
        for (const meta of archives) registerArchive(meta);
        localTerrain.refresh();
        localBuildings.refresh();
        set({ supported: true, loaded: true, archives });
        await get().refreshStorage();
      },

      refreshStorage: async () => {
        if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        const persisted = (await navigator.storage.persisted?.()) ?? false;
        set({ storage: { usage, quota, persisted } });
      },

      requestPersist: async () => {
        const ok = (await navigator.storage?.persist?.()) ?? false;
        await get().refreshStorage();
        return ok;
      },

      setDraft: (b) => set({ draft: b }),
      setDrawing: (on) => set({ drawing: on }),
      takeMapView: () => set((s) => ({ viewSeq: s.viewSeq + 1 })),

      estimate: (spec) =>
        new Promise<Estimate>((resolve, reject) => {
          const id = newId('estimate');
          handlers.set(id, (res) => {
            if (res.kind === RegionResponseKind.Estimate) {
              handlers.delete(id);
              resolve(res.estimate);
            } else if (res.kind === RegionResponseKind.Error) {
              handlers.delete(id);
              reject(new Error(res.message));
            }
          });
          post({ kind: RegionRequestKind.Estimate, id, spec });
        }),

      download: (spec) => {
        const id = newId(spec.kind);
        set((s) => ({ jobs: [...s.jobs, { ...spec, id, state: JobState.Running, done: 0, total: 0, bytes: 0, error: null, startedAt: Date.now() }] }));
        handlers.set(id, (res) => {
          if (res.kind === RegionResponseKind.Progress) {
            patchJob(id, { done: res.done, total: res.total, bytes: res.bytes });
          } else if (res.kind === RegionResponseKind.Done) {
            handlers.delete(id);
            patchJob(id, { state: JobState.Done, done: res.meta.tileCount, total: res.meta.tileCount, bytes: res.meta.bytes });
            void adopt(res.meta, spec.replaces);
          } else if (res.kind === RegionResponseKind.Error) {
            handlers.delete(id);
            patchJob(id, { state: JobState.Error, error: res.message });
          }
        });
        post({ kind: RegionRequestKind.Download, id, spec });
        return id;
      },

      cancel: (jobId) => {
        handlers.delete(jobId);
        post({ kind: RegionRequestKind.Cancel, id: jobId });
        patchJob(jobId, { state: JobState.Cancelled });
      },

      dismiss: (jobId) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== jobId) })),

      rename: async (id, name) => {
        const meta = get().archives.find((a) => a.id === id);
        if (!meta) return;
        const next = { ...meta, name: name.trim() || meta.name };
        await writeMeta(next);
        set((s) => ({ archives: s.archives.map((a) => (a.id === id ? next : a)) }));
        announceArchives();
      },

      remove: async (id) => {
        unregisterArchive(id);
        await removeArchive(id);
        set((s) => ({ archives: s.archives.filter((a) => a.id !== id) }));
        localTerrain.refresh();
        localBuildings.refresh();
        announceArchives();
        const st = settingsStore.getState();
        if (st.basemapId === `opfs:${id}`) st.update({ basemapId: DEFAULT_BASEMAP_ID });
        await get().refreshStorage();
      },

      exportArchive: async (id) => {
        const meta = get().archives.find((a) => a.id === id);
        const file = await readArchiveFile(id);
        downloadBlob(`${(meta?.name ?? id).replace(/[^\w.-]+/g, '-')}.pmtiles`, file);
      },

      importArchive: (file, name) =>
        new Promise<ArchiveMeta>((resolve, reject) => {
          const id = newId('import');
          handlers.set(id, (res) => {
            if (res.kind === RegionResponseKind.Done) {
              handlers.delete(id);
              void adopt(res.meta).then(() => resolve(res.meta));
            } else if (res.kind === RegionResponseKind.Error) {
              handlers.delete(id);
              reject(new Error(res.message));
            }
          });
          post({ kind: RegionRequestKind.Import, id, file, name: name?.trim() || file.name.replace(/\.pmtiles$/i, '') });
        })
    };
  })
);

export const useOffline = offlineStore;

/** The basemap in force, including archives downloaded for offline use. */
export function currentBasemap(): Basemap {
  const s = settingsStore.getState();
  return findBasemap(s.basemapId, s.customBasemaps, offlineBasemaps(offlineStore.getState().archives, s.offlineFlavor));
}

/** Startup must never block on OPFS, so the first listing races a short timeout. */
export async function startOffline(): Promise<void> {
  const load = offlineStore
    .getState()
    .load()
    .catch((e: unknown) => console.warn('[scape] offline load failed:', e));
  await Promise.race([load, new Promise<void>((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS))]);
}
