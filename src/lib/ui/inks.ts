/** Canvas and GL inks; mirrors the colour tokens in app.css :root. */
const fg = '#f1f1f1';
const fg2 = '#ababab';
const sun = '#f5a524';
const terrain = '#8fd18c';
const caution = '#e8c547';
const danger = '#ff5c5c';

export const Ink = {
  bg: '#111111',
  bg2: '#151515',
  bg3: '#1f1f1f',
  bg4: '#282828',
  bgDeep: '#0a0a0a',
  line: '#363636',
  scrim: '#151515eb',
  fg,
  fg2,
  fg3: '#9a9a9a',
  accent: fg,
  sun,
  sunRise: '#ffd84d',
  sunSet: '#ff7a1a',
  moon: '#5aa9ff',
  moonRise: '#9ccbff',
  moonSet: '#4f80d8',
  gc: '#b48cff',
  gcRise: '#d2bcff',
  gcSet: '#8a5cf0',
  eclipse: '#c0582e',
  terrain,
  tide: '#3cc6c0',
  cloud: '#dfe6ee',
  skyClear: '#1f4a78',
  caution,
  fog: caution,
  danger,
  losClear: terrain,
  losMarginal: caution,
  losBlocked: danger,
  losUnknown: fg2,
  pin: '#e5322d',
  pinTarget: terrain,
  edit: fg,
  chartNight: '#0e0e0e',
  chartAstro: '#151515',
  chartNautical: '#1c1c1c',
  chartCivil: '#242424',
  chartDay: '#2e2e2e',
  chartHorizon: '#5c5c5c',
  phase0: '#141414',
  phase1: '#2a2a2a',
  phase2: '#404040',
  phase3: '#555555',
  phase4: '#6b6b6b',
  phase5: '#818181',
  phase6: '#969696',
  phase7: '#acacac',
  phase8: '#c2c2c2',
  phase9: '#d7d7d7',
  markerPeak: '#c9a26b',
  markerBuilding: fg2,
  markerTree: terrain,
  markerLighthouse: '#ff6b6b',
  markerBridge: '#7fb3ff',
  markerWaterfall: '#4dd0e1',
  markerViewpoint: sun,
  markerOther: '#d0b8ff'
} as const;

/** Dark halo under edit-white geometry; shadow-halo's #00000059. */
export const HALO = 'rgba(0, 0, 0, 0.35)';

export const FONT_SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/** `#rrggbb` plus alpha as an rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
