import type { LngLat } from '@core/geo/geodesy';

// Stand-in until the first image arrives; an image source needs a URL up front.
export const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export const samePoint = (a: LngLat | null, b: LngLat | null) => a === b || (!!a && !!b && a.lat === b.lat && a.lng === b.lng);
