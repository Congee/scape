/** Official LoD2 building sets published as public 3D Tiles (CORS open, no key). */

import type { LngLat } from '@core/geo/geodesy';

export const Lod2Source = { Bag3d: 'Bag3d', Swiss: 'Swiss', Plateau: 'Plateau' } as const;
export type Lod2Source = (typeof Lod2Source)[keyof typeof Lod2Source];

export interface Lod2Region {
  id: Lod2Source;
  name: string;
  /** Root tileset.json. */
  tileset: string;
  /** Coverage, lng0, lat0, lng1, lat1. */
  bbox: readonly [number, number, number, number];
  licence: string;
  /** Shown whenever this region's tiles are drawn. */
  attribution: string;
  attributionUrl: string;
  /** Content heights minus sea level, when no per-building ground says otherwise. */
  geoidM: number;
  /** Heights came from JGD2011 orthometric heights through GSIGEO2011, so a user-imported GSI grid replaces `geoidM`. */
  gsiGeoid?: boolean;
  /** Per-building ground height above sea level, in the tile's property table. */
  groundProperty?: string;
  /** Stable building id in the property table. */
  idProperty?: string;
}

const PLATEAU_ASSETS = 'https://assets.cms.plateau.reearth.io/assets/';

/** PLATEAU publishes one tileset per city; they share an id so the credit shows once. */
function plateau(city: string, path: string, bbox: Lod2Region['bbox']): Lod2Region {
  return {
    id: Lod2Source.Plateau,
    name: `PLATEAU ${city} (Japan)`,
    tileset: PLATEAU_ASSETS + path,
    bbox,
    licence: 'PLATEAU terms (CC BY 4.0 compatible)',
    attribution: '© MLIT Project PLATEAU',
    attributionUrl: 'https://www.mlit.go.jp/plateau/',
    // Tokyo's geoid; the tiles have no ground column.
    geoidM: 36.7,
    gsiGeoid: true,
    idProperty: 'gml_id'
  };
}

export const LOD2_REGIONS: readonly Lod2Region[] = [
  {
    id: Lod2Source.Bag3d,
    name: '3DBAG (Netherlands)',
    tileset: 'https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json',
    bbox: [3.2, 50.7, 7.3, 53.6],
    licence: 'CC BY 4.0',
    attribution: '© 3DBAG by tudelft3d and 3DGI, CC BY 4.0',
    attributionUrl: 'https://3dbag.nl',
    geoidM: 43.6,
    groundProperty: 'b3_h_maaiveld',
    idProperty: 'identificatie'
  },
  {
    id: Lod2Source.Swiss,
    name: 'swissBUILDINGS3D (Switzerland)',
    tileset: 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/20260520/tileset.json',
    bbox: [5.96, 45.82, 10.49, 47.81],
    licence: 'OGD (free, attribution)',
    attribution: '© swisstopo',
    attributionUrl: 'https://www.swisstopo.admin.ch',
    // Heights are above sea level already; walls run below GELAENDEPUNKT, so it cannot set the datum.
    geoidM: 0,
    idProperty: 'UUID'
  },
  plateau('Chiyoda', '72/e900e5-938c-4376-a9de-a124b270880c/13101_chiyoda-ku_pref_2025_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod2_no_texture/tileset.json', [139.7302, 35.669, 139.7828, 35.7052]),
  plateau('Chuo', '92/43303e-6eb5-44ad-b65f-e21e63bdf98a/13102_chuo-ku_pref_2025_citygml_1_op_bldg_3dtiles_13102_chuo-ku_lod2_no_texture/tileset.json', [139.7588, 35.6463, 139.792, 35.6964]),
  plateau('Minato', 'c7/1aabcb-eb54-4cfe-9b75-3a6458c9d29e/13103_minato-ku_pref_2025_citygml_1_op_bldg_3dtiles_13103_minato-ku_lod2_no_texture/tileset.json', [139.7088, 35.6188, 139.7824, 35.6825]),
  plateau('Shinjuku', '2f/d4f9a7-13ad-43cb-b984-033803199eab/13104_shinjuku-ku_pref_2025_citygml_1_op_bldg_3dtiles_13104_shinjuku-ku_lod2_no_texture/tileset.json', [139.6733, 35.6735, 139.7444, 35.7297]),
  plateau('Bunkyo', 'ed/58552b-52fc-484b-99c0-b1313e2d717d/13105_bunkyo-ku_pref_2025_citygml_1_op_bldg_3dtiles_13105_bunkyo-ku_lod2_no_texture/tileset.json', [139.7173, 35.6996, 139.7724, 35.7359]),
  plateau('Taito', '89/471b74-c5ca-4673-afaa-c194d18b5c8c/13106_taito-ku_city_2025_citygml_1_op_bldg_3dtiles_lod2_no_texture/tileset.json', [139.7624, 35.6952, 139.8088, 35.7316]),
  plateau('Sumida', '8a/cb11d1-af42-4a84-a63c-6c6461896e2b/13107_sumida-ku_pref_2025_citygml_1_op_bldg_3dtiles_13107_sumida-ku_lod2_no_texture/tileset.json', [139.7897, 35.6868, 139.8396, 35.7424]),
  plateau('Koto', '69/e06917-ca70-4b93-810b-765fb29ce233/13108_koto-ku_pref_2025_citygml_1_op_bldg_3dtiles_13108_koto-ku_lod2_no_texture/tileset.json', [139.7702, 35.5787, 139.8493, 35.7076]),
  plateau('Shinagawa', 'be/403449-37a8-4dbb-a756-c3d4e6639f5d/13109_shinagawa-ku_pref_2025_citygml_1_op_bldg_3dtiles_13109_shinagawa-ku_lod2_no_texture/tileset.json', [139.6952, 35.5851, 139.7735, 35.6416]),
  plateau('Meguro', '84/6f6772-5536-45b6-a7bd-fae36735a79a/13110_meguro-ku_pref_2025_citygml_1_op_bldg_3dtiles_13110_meguro-ku_lod2_no_texture/tileset.json', [139.6617, 35.6006, 139.7177, 35.6641]),
  plateau('Ota', '1b/e7ae85-9dbb-4b17-af10-86da7641d370/13111_ota-ku_pref_2025_citygml_1_op_bldg_3dtiles_13111_ota-ku_lod2_no_texture/tileset.json', [139.6529, 35.5234, 139.8254, 35.6131]),
  plateau('Setagaya', '1a/57c9bb-cbed-47c0-be15-bbe662eabce4/13112_setagaya-ku_pref_2025_citygml_1_op_bldg_3dtiles_13112_setagaya-ku_lod2_no_texture/tileset.json', [139.5825, 35.5919, 139.6865, 35.6828]),
  plateau('Shibuya', '4c/92c509-8082-47cb-9c0c-cab712d49dbd/13113_shibuya-ku_pref_2025_citygml_1_op_bldg_3dtiles_13113_shibuya-ku_lod2_no_texture/tileset.json', [139.6614, 35.6412, 139.7238, 35.6921]),
  plateau('Nakano', 'b7/d791c7-3f75-4050-b8bd-73bdc13b7b06/13114_nakano-ku_pref_2025_citygml_1_op_bldg_3dtiles_13114_nakano-ku_lod2_no_texture/tileset.json', [139.6243, 35.6766, 139.6941, 35.7355]),
  plateau('Suginami', 'e2/1fef96-52b5-4de3-9431-51e020f5c02c/13115_suginami-ku_city_2025_citygml_1_op_bldg_3dtiles_13115_suginami-ku_lod2_no_texture/tileset.json', [139.5852, 35.6659, 139.6675, 35.7304]),
  plateau('Toshima', '00/c773a5-1b08-48bc-9f65-958952afd4db/13116_toshima-ku_pref_2025_citygml_1_op_bldg_3dtiles_13116_toshima-ku_lod2_no_texture/tileset.json', [139.6777, 35.7124, 139.7526, 35.7459]),
  plateau('Kita', '31/7809c7-4856-4b02-9667-43769ada845b/13117_kita-ku_pref_2025_citygml_1_op_bldg_3dtiles_13117_kita-ku_lod2_no_texture/tileset.json', [139.6895, 35.7317, 139.7707, 35.7955]),
  plateau('Arakawa', '14/3bfbb7-a021-4fc4-95e7-7a4f6d8c4e2a/13118_arakawa-ku_pref_2025_citygml_1_op_bldg_3dtiles_13118_arakawa-ku_lod2_no_texture/tileset.json', [139.7495, 35.7248, 139.8134, 35.7542]),
  plateau('Itabashi', 'fa/9dd850-4b6b-4c55-b32e-081a5f23c8da/13119_itabashi-ku_pref_2025_citygml_1_op_bldg_3dtiles_13119_itabashi-ku_lod2_no_texture/tileset.json', [139.6245, 35.7358, 139.7227, 35.7995]),
  plateau('Nerima', 'e2/1a7f05-4810-4330-a66d-24956da0040b/13120_nerima-ku_pref_2025_citygml_1_op_bldg_3dtiles_13120_nerima-ku_lod2_no_texture/tileset.json', [139.563, 35.7118, 139.6811, 35.78]),
  plateau('Adachi', '60/d9f227-68b4-41a4-a893-8b56bb826f3b/13121_adachi-ku_pref_2025_citygml_1_op_bldg_3dtiles_13121_adachi-ku_lod2_no_texture/tileset.json', [139.7367, 35.7392, 139.8578, 35.8175]),
  plateau('Katsushika', '61/269e0d-405d-47e6-a28d-b955dfef8d34/13122_katsushika-ku_pref_2025_citygml_1_op_bldg_3dtiles_13122_katsushika-ku_lod2_no_texture/tileset.json', [139.8134, 35.7122, 139.8905, 35.7966]),
  plateau('Edogawa', 'ca/d926ee-b9fd-44af-9643-e5f49bdf584a/13123_edogawa-ku_pref_2025_citygml_1_op_bldg_3dtiles_13123_edogawa-ku_lod2_no_texture/tileset.json', [139.8337, 35.6379, 139.9175, 35.7505])
];

/** The regions whose coverage reaches within `rangeM` of `p`. */
export function lod2RegionsNear(p: LngLat, rangeM: number): Lod2Region[] {
  const dLat = rangeM / 111_195;
  const dLng = dLat / Math.max(0.01, Math.cos((p.lat * Math.PI) / 180));
  return LOD2_REGIONS.filter((r) => p.lng + dLng >= r.bbox[0] && p.lng - dLng <= r.bbox[2] && p.lat + dLat >= r.bbox[1] && p.lat - dLat <= r.bbox[3]);
}

/** One region per source, for attribution. */
export function lod2Credits(ids: Iterable<Lod2Source>): Lod2Region[] {
  const want = new Set(ids);
  return LOD2_REGIONS.filter((r, i, all) => want.has(r.id) && all.findIndex((x) => x.id === r.id) === i);
}
