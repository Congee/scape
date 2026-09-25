/** Open-Meteo forecast models the picker offers; values are the API `models` ids. */
export const WeatherModel = {
  BestMatch: 'best_match',
  EcmwfIfs: 'ecmwf_ifs',
  EcmwfIfs025: 'ecmwf_ifs025',
  Gfs: 'ncep_gfs_seamless',
  Icon: 'dwd_icon_seamless',
  MeteoFrance: 'meteofrance_seamless',
  AromeHd: 'meteofrance_arome_france_hd',
  Ukmo: 'ukmo_seamless',
  Knmi: 'knmi_seamless',
  HarmonieNl: 'knmi_harmonie_arome_netherlands',
  Dmi: 'dmi_seamless',
  MetNo: 'metno_seamless',
  Jma: 'jma_seamless',
  Gem: 'cmc_gem_seamless'
} as const;
export type WeatherModel = (typeof WeatherModel)[keyof typeof WeatherModel];

export interface ModelInfo {
  id: WeatherModel;
  label: string;
  /** Grid resolution as the provider states it. */
  grid: string;
  /** Finest grid spacing, km; map samples are never denser. */
  minKm: number;
  /** Id of the /data/<id>/static/meta.json run record; absent for blends, whose run is not one time. */
  metaId?: string;
}

export const MODELS: readonly ModelInfo[] = [
  { id: WeatherModel.BestMatch, label: 'Best match', grid: 'varies by place (1–25 km)', minKm: 2 },
  { id: WeatherModel.EcmwfIfs, label: 'ECMWF IFS HRES', grid: '9 km', minKm: 9, metaId: 'ecmwf_ifs' },
  { id: WeatherModel.EcmwfIfs025, label: 'ECMWF IFS 0.25°', grid: '25 km', minKm: 25, metaId: 'ecmwf_ifs025' },
  { id: WeatherModel.Gfs, label: 'NOAA GFS / HRRR', grid: '3–25 km', minKm: 3 },
  { id: WeatherModel.Icon, label: 'DWD ICON', grid: '2–11 km', minKm: 2 },
  { id: WeatherModel.MeteoFrance, label: 'Météo-France', grid: '1.5–25 km', minKm: 1.5 },
  { id: WeatherModel.AromeHd, label: 'Météo-France AROME HD', grid: '1.5 km', minKm: 1.5, metaId: 'meteofrance_arome_france_hd' },
  { id: WeatherModel.Ukmo, label: 'UK Met Office', grid: '2–10 km', minKm: 2 },
  { id: WeatherModel.Knmi, label: 'KNMI', grid: '2–9 km', minKm: 2 },
  { id: WeatherModel.HarmonieNl, label: 'KNMI Harmonie NL', grid: '2 km', minKm: 2, metaId: 'knmi_harmonie_arome_netherlands' },
  { id: WeatherModel.Dmi, label: 'DMI', grid: '2–9 km', minKm: 2 },
  { id: WeatherModel.MetNo, label: 'MET Norway', grid: '1–9 km', minKm: 1 },
  { id: WeatherModel.Jma, label: 'JMA', grid: '5–55 km', minKm: 5 },
  { id: WeatherModel.Gem, label: 'Canada GEM', grid: '2.5–15 km', minKm: 2.5 }
];

export const modelInfo = (id: string): ModelInfo => MODELS.find((m) => m.id === id) ?? MODELS[0];
