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

export interface ScapeExport {
  format: 'scape';
  version: 1;
  exportedAt: string;
  locations: SavedLocation[];
  markers: SavedMarker[];
  plans: SavedPlan[];
}
