import type { Bbox } from '@core/geo/bbox';
import type { GeoidMeta } from '@data/geoid';

export const ArchiveKind = { Basemap: 'basemap', Terrain: 'terrain', Buildings: 'buildings' } as const;
export type ArchiveKind = (typeof ArchiveKind)[keyof typeof ArchiveKind];

/** An offline archive in OPFS, mirrored by a `<id>.json` sidecar next to `<id>.pmtiles`. */
export interface ArchiveMeta {
  id: string;
  name: string;
  kind: ArchiveKind;
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  bytes: number;
  tileCount: number;
  sourceUrl: string;
  /** ISO timestamp. */
  downloadedAt: string;
  /** Style the archive was packed for; its local copy sits in `<id>.assets/style.json`. */
  style?: string;
}

export interface RegionSpec {
  kind: ArchiveKind;
  name: string;
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  sourceUrl: string;
  /** Archive id superseded once this download succeeds. */
  replaces?: string;
  /** Style to cache with a TileJSON basemap source. */
  styleUrl?: string;
}

export interface Estimate {
  tileCount: number;
  bytes: number;
  exact: boolean;
  /** The URL that answered; a basemap build date may fall back to an earlier day. */
  sourceUrl: string;
  /** Build day of a TileJSON source, "2026-09-13". */
  build?: string;
}

export const RegionRequestKind = { Estimate: 'Estimate', Download: 'Download', Import: 'Import', ImportGeoid: 'ImportGeoid', Cancel: 'Cancel' } as const;
export type RegionRequestKind = (typeof RegionRequestKind)[keyof typeof RegionRequestKind];

export const RegionResponseKind = { Estimate: 'Estimate', Progress: 'Progress', Done: 'Done', Geoid: 'Geoid', Error: 'Error' } as const;
export type RegionResponseKind = (typeof RegionResponseKind)[keyof typeof RegionResponseKind];

export type RegionRequest =
  | { kind: typeof RegionRequestKind.Estimate; id: string; spec: RegionSpec }
  | { kind: typeof RegionRequestKind.Download; id: string; spec: RegionSpec }
  | { kind: typeof RegionRequestKind.Import; id: string; file: File; name: string }
  | { kind: typeof RegionRequestKind.ImportGeoid; id: string; file: File }
  | { kind: typeof RegionRequestKind.Cancel; id: string };

export type RegionResponse =
  | { kind: typeof RegionResponseKind.Estimate; id: string; estimate: Estimate }
  | { kind: typeof RegionResponseKind.Progress; id: string; done: number; total: number; bytes: number }
  | { kind: typeof RegionResponseKind.Done; id: string; meta: ArchiveMeta }
  | { kind: typeof RegionResponseKind.Geoid; id: string; meta: GeoidMeta }
  | { kind: typeof RegionResponseKind.Error; id: string; message: string };
