import type { FinderSettings } from './astro/finder';
import type { LngLat } from './geo/geodesy';
import type { Orientation } from './optics/fov';

export interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tz?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export const MarkerCategory = {
  Peak: 'Peak',
  Building: 'Building',
  Tree: 'Tree',
  Lighthouse: 'Lighthouse',
  Bridge: 'Bridge',
  Waterfall: 'Waterfall',
  Viewpoint: 'Viewpoint',
  Other: 'Other'
} as const;
export type MarkerCategory = (typeof MarkerCategory)[keyof typeof MarkerCategory];

/** How the viewfinder draws the marker: a flat bar, or a flat-shaded 3D solid. */
export const MarkerShape = {
  Bar: 'Bar',
  Box: 'Box',
  Cylinder: 'Cylinder',
  Spire: 'Spire'
} as const;
export type MarkerShape = (typeof MarkerShape)[keyof typeof MarkerShape];

export interface SavedMarker {
  id: string;
  name: string;
  category: MarkerCategory;
  lat: number;
  lng: number;
  /** Height above ground, metres (0 for a bare point). */
  heightM: number;
  /** Width across the sightline, metres; drawn in the viewfinder when > 0. */
  widthM: number;
  /** Viewfinder solid; absent means Bar. */
  shape?: MarkerShape;
  /** Footprint depth along the rotation axis, metres; Box only, defaults to widthM. */
  depthM?: number;
  /** Footprint rotation, degrees clockwise from north about the marker point. */
  rotationDeg?: number;
  /** 0 (unrated) to 5. */
  rating: number;
  notes: string;
  showInViewfinder: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PlanComposition {
  sensorId: string;
  focalMm: number;
  fNumber: number;
  orientation: Orientation;
  azimuthDeg: number;
  elevationDeg: number;
  aimAtTarget: boolean;
}

export interface PlanPoint {
  lat: number;
  lng: number;
  heightM: number;
}

export interface SavedPlan {
  id: string;
  name: string;
  camera: PlanPoint;
  target: PlanPoint | null;
  /** Epoch ms of the planned moment. */
  time: number;
  tz: string;
  tzAuto: boolean;
  composition: PlanComposition;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/** A finder search kept for re-running; the pin records where it was run from. */
export interface SavedSearch {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pin: LngLat | null;
  settings: FinderSettings;
}

export interface ScapeExport {
  format: 'scape';
  version: 1;
  exportedAt: string;
  locations: SavedLocation[];
  markers: SavedMarker[];
  plans: SavedPlan[];
  /** Added after version 1; absent in older files. */
  searches?: SavedSearch[];
}
