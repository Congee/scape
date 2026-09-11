import tzLookup from '@photostructure/tz-lookup';
import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import type { LngLat } from '@core/geo/geodesy';
import { addLocalDays, withLocalDate } from '@core/time/localDay';

export interface MapView {
  center: LngLat;
  zoom: number;
}

export interface FlyRequest extends MapView {
  seq: number;
  animate: boolean;
}

export interface WorldState {
  pin: LngLat;
  /** Observer height above local ground, metres (horizon dip). */
  pinHeightM: number;
  /** Simulated clock, epoch ms. */
  time: number;
  /** True while the clock follows real time. */
  live: boolean;
  tz: string;
  tzAuto: boolean;
  view: MapView;
  fly: FlyRequest | null;
  setPin(pin: LngLat): void;
  setPinHeight(m: number): void;
  setTime(ms: number): void;
  nudgeTime(deltaMs: number): void;
  setDate(isoDate: string): void;
  addDays(days: number): void;
  setNow(): void;
  setTz(tz: string | null): void;
  setView(view: MapView): void;
  flyTo(center: LngLat, zoom?: number, animate?: boolean): void;
}

export function tzForPoint(p: LngLat): string {
  try {
    return tzLookup(p.lat, p.lng);
  } catch {
    return 'Etc/UTC';
  }
}

const DEFAULT_PIN: LngLat = { lat: 40.7463, lng: -74.1553 };

export const worldStore = create<WorldState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        pin: DEFAULT_PIN,
        pinHeightM: 0,
        time: Date.now(),
        live: true,
        tz: tzForPoint(DEFAULT_PIN),
        tzAuto: true,
        view: { center: DEFAULT_PIN, zoom: 11 },
        fly: null,
        setPin: (pin) => set((s) => ({ pin, tz: s.tzAuto ? tzForPoint(pin) : s.tz })),
        setPinHeight: (pinHeightM) => set({ pinHeightM }),
        setTime: (time) => set({ time, live: false }),
        nudgeTime: (d) => set((s) => ({ time: s.time + d, live: false })),
        setDate: (iso) => set((s) => ({ time: withLocalDate(new Date(s.time), iso, s.tz).getTime(), live: false })),
        addDays: (n) => set((s) => ({ time: addLocalDays(new Date(s.time), n, s.tz).getTime(), live: false })),
        setNow: () => set({ time: Date.now(), live: true }),
        setTz: (tz) => set((s) => (tz ? { tz, tzAuto: false } : { tz: tzForPoint(s.pin), tzAuto: true })),
        setView: (view) => set({ view }),
        flyTo: (center, zoom, animate = true) =>
          set((s) => ({ fly: { center, zoom: zoom ?? s.view.zoom, animate, seq: (s.fly?.seq ?? 0) + 1 } }))
      }),
      {
        name: 'scape.world',
        partialize: (s) => ({ pin: s.pin, pinHeightM: s.pinHeightM, tz: s.tz, tzAuto: s.tzAuto, view: s.view })
      }
    )
  )
);

export const useWorld = worldStore;
