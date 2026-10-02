import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { PointRecord } from '@core/io/points';
import { MarkerCategory, MarkerShape, type SavedMarker } from '@core/plan';
import { deleteOne, listAll, putOne } from '@data/db';

export interface MarkersState {
  markers: SavedMarker[];
  loaded: boolean;
  selectedId: string | null;
  /** Next map click drops a marker. */
  placing: boolean;
  load(): Promise<void>;
  save(input: Partial<SavedMarker> & Pick<SavedMarker, 'lat' | 'lng'>): Promise<SavedMarker>;
  remove(id: string): Promise<void>;
  select(id: string | null): void;
  setPlacing(on: boolean): void;
  importPoints(points: PointRecord[]): Promise<number>;
}

const withDefaults = (input: Partial<SavedMarker> & Pick<SavedMarker, 'lat' | 'lng'>, n: number): SavedMarker => {
  const now = Date.now();
  return {
    id: input.id ?? crypto.randomUUID(),
    name: input.name?.trim() || `Marker ${n}`,
    category: input.category ?? MarkerCategory.Other,
    lat: input.lat,
    lng: input.lng,
    ...(input.digits ? { digits: input.digits } : {}),
    heightM: input.heightM ?? 0,
    widthM: input.widthM ?? 0,
    shape: input.shape ?? MarkerShape.Bar,
    depthM: input.depthM,
    rotationDeg: input.rotationDeg ?? 0,
    rating: input.rating ?? 0,
    notes: input.notes ?? '',
    showInViewfinder: input.showInViewfinder ?? true,
    createdAt: input.createdAt ?? now,
    updatedAt: now
  };
};

export const markersStore = create<MarkersState>()(
  subscribeWithSelector((set, get) => ({
    markers: [],
    loaded: false,
    selectedId: null,
    placing: false,
    load: async () => {
      set({ markers: await listAll('markers'), loaded: true });
    },
    save: async (input) => {
      const m = withDefaults(input, get().markers.length + 1);
      await putOne('markers', m);
      await get().load();
      return m;
    },
    remove: async (id) => {
      await deleteOne('markers', id);
      set((s) => ({ selectedId: s.selectedId === id ? null : s.selectedId }));
      await get().load();
    },
    select: (selectedId) => set({ selectedId }),
    setPlacing: (placing) => set({ placing }),
    importPoints: async (points) => {
      const n = get().markers.length;
      await Promise.all(points.map((p, i) => putOne('markers', withDefaults(p, n + i + 1))));
      await get().load();
      return points.length;
    }
  }))
);

export const useMarkers = markersStore;
