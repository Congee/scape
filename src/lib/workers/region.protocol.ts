import type { Bbox } from '@core/geo/bbox';

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
}

export interface Estimate {
  tileCount: number;
  bytes: number;
  exact: boolean;
  /** The URL that answered; a basemap build date may fall back to an earlier day. */
  sourceUrl: string;
}

export const RegionRequestKind = { Estimate: 'Estimate', Download: 'Download', Import: 'Import', Cancel: 'Cancel' } as const;
export type RegionRequestKind = (typeof RegionRequestKind)[keyof typeof RegionRequestKind];

export const RegionResponseKind = { Estimate: 'Estimate', Progress: 'Progress', Done: 'Done', Error: 'Error' } as const;
export type RegionResponseKind = (typeof RegionResponseKind)[keyof typeof RegionResponseKind];

export type RegionRequest =
  | { kind: typeof RegionRequestKind.Estimate; id: string; spec: RegionSpec }
  | { kind: typeof RegionRequestKind.Download; id: string; spec: RegionSpec }
  | { kind: typeof RegionRequestKind.Import; id: string; file: File; name: string }
  | { kind: typeof RegionRequestKind.Cancel; id: string };

export type RegionResponse =
  | { kind: typeof RegionResponseKind.Estimate; id: string; estimate: Estimate }
  | { kind: typeof RegionResponseKind.Progress; id: string; done: number; total: number; bytes: number }
  | { kind: typeof RegionResponseKind.Done; id: string; meta: ArchiveMeta }
  | { kind: typeof RegionResponseKind.Error; id: string; message: string };
