import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { LngLat } from '@core/geo/geodesy';

export interface MapStatusState {
  /** Last basemap/tile error message, cleared when a style loads or the failed source loads a tile. */
  error: string | null;
  /** Source of the last tile error; null for a style error. */
  errorSource: string | null;
  /** Satellite is on but no usable source has imagery in view. */
  satGap: boolean;
  /** Bumped by Retry; the map reloads what failed. */
  retrySeq: number;
  /** Whether the loaded basemap puts `p` in town; null until the map has looked there. */
  urban: { p: LngLat; urban: boolean } | null;
  setError(error: string | null, source?: string | null): void;
  setSatGap(gap: boolean): void;
  retry(): void;
  setUrban(p: LngLat, urban: boolean): void;
}

export const mapStatusStore = create<MapStatusState>()(
  subscribeWithSelector((set, get) => ({
    error: null,
    errorSource: null,
    satGap: false,
    retrySeq: 0,
    urban: null,
    setError: (error, source = null) => {
      const s = get();
      const errorSource = error ? source : null;
      if (s.error !== error || s.errorSource !== errorSource) set({ error, errorSource });
    },
    setSatGap: (satGap) => {
      if (get().satGap !== satGap) set({ satGap });
    },
    // The source stays so the map knows what to reload.
    retry: () => set((s) => ({ error: null, retrySeq: s.retrySeq + 1 })),
    setUrban: (p, urban) => {
      const u = get().urban;
      if (u?.urban !== urban || u.p.lat !== p.lat || u.p.lng !== p.lng) set({ urban: { p, urban } });
    }
  }))
);

export const useMapStatus = mapStatusStore;

export const MapNoticeKind = { Offline: 'Offline', TilesFailed: 'TilesFailed', NoSatellite: 'NoSatellite' } as const;
export type MapNoticeKind = (typeof MapNoticeKind)[keyof typeof MapNoticeKind];

export interface MapNotice {
  kind: MapNoticeKind;
  text: string;
  retry: boolean;
}

/** The one line the map shows about what it cannot draw; offline explains failed tiles, so it wins. */
export function mapNotice(s: { online: boolean; tileError: boolean; satGap: boolean }): MapNotice | null {
  if (!s.online) return { kind: MapNoticeKind.Offline, text: 'Offline: showing cached map only', retry: false };
  if (s.tileError) return { kind: MapNoticeKind.TilesFailed, text: "Map tiles couldn't load", retry: true };
  if (s.satGap) return { kind: MapNoticeKind.NoSatellite, text: 'No satellite imagery here without a MapTiler key', retry: false };
  return null;
}
