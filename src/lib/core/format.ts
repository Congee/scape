export type Units = 'metric' | 'imperial';

export function degrees(n: number, digits = 2): string {
  return `${n.toFixed(digits)}°`;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compass(azimuth: number): string {
  return POINTS[Math.round((((azimuth % 360) + 360) % 360) / 22.5) % 16];
}

export function percent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function distance(m: number, units: Units): string {
  if (units === 'imperial') {
    const ft = m * 3.28084;
    return ft < 1000 ? `${ft.toFixed(0)} ft` : `${(ft / 5280).toFixed(ft < 52800 ? 2 : 1)} mi`;
  }
  return m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

export function height(m: number, units: Units): string {
  return units === 'imperial' ? `${(m * 3.28084).toFixed(0)} ft` : `${m.toFixed(0)} m`;
}
