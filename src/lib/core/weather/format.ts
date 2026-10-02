import { Units } from '@core/format';
import { FogClass } from './fog';

const na = (v: number) => Number.isNaN(v);

export const pct = (v: number) => (na(v) ? 'n/a' : `${Math.round(v)}%`);
export const tempText = (c: number, u: Units) => (na(c) ? 'n/a' : u === Units.Imperial ? `${Math.round((c * 9) / 5 + 32)} °F` : `${c.toFixed(1)} °C`);
export const windText = (kmh: number, u: Units) => (na(kmh) ? 'n/a' : u === Units.Imperial ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`);
export const rainText = (mm: number, u: Units) => (na(mm) ? 'n/a' : u === Units.Imperial ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`);

export function visText(m: number, u: Units): string {
  if (na(m)) return 'n/a';
  if (u === Units.Imperial) return `${(m / 1609.344).toFixed(m < 16093 ? 1 : 0)} mi`;
  return m < 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`;
}

/** "12 min", "3 h", "2 d" */
export function ageText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

/** One-line sky verdict for a place's hour: fog first, then cloud cover, then a likely shower. */
export function skyVerdict(cloud: number, fog: FogClass, precipProb: number): string {
  const sky = fog !== FogClass.None ? `${fog} possible` : na(cloud) ? 'Cloud n/a' : cloud < 25 ? `Clear · ${pct(cloud)}` : cloud < 80 ? `Partly cloudy · ${pct(cloud)}` : `Overcast · ${pct(cloud)}`;
  return precipProb >= 30 ? `${sky} · rain ${pct(precipProb)}` : sky;
}
