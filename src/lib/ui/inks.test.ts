import { describe, expect, it } from 'vitest';
import { Ink, withAlpha } from './inks';

// Copy of the design system's tokens.json colour values.
const TOKENS: Record<string, string> = {
  bg: '#111111', 'bg-2': '#151515', 'bg-3': '#1f1f1f', 'bg-4': '#282828', 'bg-deep': '#0a0a0a',
  line: '#363636', scrim: '#151515eb', fg: '#f1f1f1', 'fg-2': '#ababab', 'fg-3': '#9a9a9a', accent: '{fg}',
  sun: '#f5a524', 'sun-rise': '#ffd84d', 'sun-set': '#ff7a1a',
  moon: '#5aa9ff', 'moon-rise': '#9ccbff', 'moon-set': '#4f80d8',
  gc: '#b48cff', 'gc-rise': '#d2bcff', 'gc-set': '#8a5cf0',
  eclipse: '#c0582e', terrain: '#8fd18c', tide: '#3cc6c0', cloud: '#dfe6ee', 'sky-clear': '#1f4a78',
  caution: '#e8c547', fog: '{caution}', danger: '#ff5c5c',
  'los-clear': '{terrain}', 'los-marginal': '{caution}', 'los-blocked': '{danger}', 'los-unknown': '{fg-2}',
  pin: '#e5322d', 'pin-target': '{terrain}', edit: '{fg}',
  'chart-night': '#0e0e0e', 'chart-astro': '#151515', 'chart-nautical': '#1c1c1c', 'chart-civil': '#242424',
  'chart-day': '#2e2e2e', 'chart-horizon': '#5c5c5c',
  'phase-0': '#141414', 'phase-1': '#2a2a2a', 'phase-2': '#404040', 'phase-3': '#555555', 'phase-4': '#6b6b6b',
  'phase-5': '#818181', 'phase-6': '#969696', 'phase-7': '#acacac', 'phase-8': '#c2c2c2', 'phase-9': '#d7d7d7',
  'marker-peak': '#c9a26b', 'marker-building': '{fg-2}', 'marker-tree': '{terrain}', 'marker-lighthouse': '#ff6b6b',
  'marker-bridge': '#7fb3ff', 'marker-waterfall': '#4dd0e1', 'marker-viewpoint': '{sun}', 'marker-other': '#d0b8ff'
};

const resolve = (v: string): string => (v.startsWith('{') ? resolve(TOKENS[v.slice(1, -1)]) : v);
const camel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

describe('Ink', () => {
  it('mirrors every colour token', () => {
    const expected = Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => [camel(k), resolve(v)]));
    expect(Ink).toEqual(expected);
  });
});

describe('withAlpha', () => {
  it('turns hex into rgba', () => {
    expect(withAlpha('#8fd18c', 0.5)).toBe('rgba(143, 209, 140, 0.5)');
  });
});
