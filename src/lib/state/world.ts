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
  /** Target location (sightline target, composition subject); null when off. */
  pin2: LngLat | null;
  /** Target height above ground at the target location, metres. */
  pin2HeightM: number;
  /** True while `pin2HeightM` is the building height the map read, not a typed one. */
  pin2HeightAuto: boolean;
  /** Name of the model an auto height came from; null for an Overture or OSM one. */
  pin2HeightFrom: string | null;
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
  setPin2(pin: LngLat | null): void;
  setPin2Height(m: number, auto?: boolean, from?: string | null): void;
  swapPins(): void;
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

// A URL round-trip rounds to 5 decimals (~1 m), so re-applying the same target must still count as the same point.
const SAME_POINT_DEG = 1e-5;
const samePoint = (a: LngLat | null, b: LngLat | null) =>
  a === b || (!!a && !!b && Math.abs(a.lat - b.lat) < SAME_POINT_DEG && Math.abs(a.lng - b.lng) < SAME_POINT_DEG);

export const worldStore = create<WorldState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        pin: DEFAULT_PIN,
        pinHeightM: 0,
        pin2: null,
        pin2HeightM: 0,
        pin2HeightAuto: false,
        pin2HeightFrom: null,
        time: Date.now(),
        live: true,
        tz: tzForPoint(DEFAULT_PIN),
        tzAuto: true,
        view: { center: DEFAULT_PIN, zoom: 11 },
        fly: null,
        setPin: (pin) => set((s) => ({ pin, tz: s.tzAuto ? tzForPoint(pin) : s.tz })),
        setPinHeight: (pinHeightM) => set({ pinHeightM }),
        // A height the map read belongs to the old building, so moving the target anywhere else drops it.
        setPin2: (pin2) => set((s) => (s.pin2HeightAuto && !samePoint(s.pin2, pin2) ? { pin2, pin2HeightM: 0, pin2HeightAuto: false, pin2HeightFrom: null } : { pin2 })),
        setPin2Height: (pin2HeightM, pin2HeightAuto = false, from = null) => set({ pin2HeightM, pin2HeightAuto, pin2HeightFrom: pin2HeightAuto ? from : null }),
        swapPins: () =>
          set((s) => (s.pin2 ? { pin: s.pin2, pin2: s.pin, tz: s.tzAuto ? tzForPoint(s.pin2) : s.tz } : {})),
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
        // A live clock needs no stored instant; leaving it out also keeps the per-second tick from waking the other tabs.
        partialize: (s) => ({ pin: s.pin, pinHeightM: s.pinHeightM, pin2: s.pin2, pin2HeightM: s.pin2HeightM, pin2HeightAuto: s.pin2HeightAuto, pin2HeightFrom: s.pin2HeightFrom, tz: s.tz, tzAuto: s.tzAuto, view: s.view, live: s.live, ...(s.live ? {} : { time: s.time }) })
      }
    )
  )
);

export const useWorld = worldStore;

/** The clock for panels that plan rather than track: exact when set, whole minutes while live, so a tick rarely re-renders them. */
export const planTime = (s: Pick<WorldState, 'live' | 'time'>) => (s.live ? s.time - (s.time % 60_000) : s.time);
export const usePlanTime = () => useWorld(planTime);
