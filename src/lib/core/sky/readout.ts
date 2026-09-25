/** Text and curves the Night tab shows for modelled sky brightness. */

import { compass } from '@core/format';
import { moonlitSky, separationDeg } from './moonlight';
import type { Dome, GlowToward, Skyglow } from './skyglow';

export const SKY_TOOLTIP = 'Models artificial light only, on a moonless, clear night.';

export const SkySourceKind = { Yearly: 'Yearly', Nightly: 'Nightly' } as const;
export type SkySourceKind = (typeof SkySourceKind)[keyof typeof SkySourceKind];

/** Where a reading's radiance came from: an imported VNP46A4 year, or GIBS nightly tiles (nights newest first). */
export type SkySource = { kind: typeof SkySourceKind.Yearly; year: number } | { kind: typeof SkySourceKind.Nightly; nights: readonly string[] };

export const sourceText = (s: SkySource): string => (s.kind === SkySourceKind.Yearly ? `VIIRS ${s.year} model` : `VIIRS nightly, ${s.nights.length} night${s.nights.length === 1 ? '' : 's'} to ${s.nights[0]}`);

export const skyReadout = (g: Skyglow, s: SkySource): string => `Sky ≈ ${g.mag.toFixed(1)} mag/arcsec² · Bortle ≈ ${g.bortle.label} · ${sourceText(s)}`;

export const domeText = (d: Dome): string => `dome ${Math.round(d.azimuthDeg)}° ${compass(d.azimuthDeg)}, ~${d.heightDeg < 1 ? d.heightDeg.toFixed(1) : Math.round(d.heightDeg)}° high${d.hidden ? ', behind terrain' : ''}`;

export const GlowLevel = { None: 'None', Faint: 'Faint', Glow: 'Glow', Dome: 'Dome' } as const;
export type GlowLevel = (typeof GlowLevel)[keyof typeof GlowLevel];

/** Prominence bands over an even share; the Dome band matches DOME_PROMINENCE. */
export const glowLevel = (t: GlowToward): GlowLevel => (t.hidden || t.prominence < 1 ? GlowLevel.None : t.prominence < 2 ? GlowLevel.Faint : t.prominence < 4 ? GlowLevel.Glow : GlowLevel.Dome);

const LEVEL_TEXT: Record<GlowLevel, string> = { None: 'no notable glow', Faint: 'faint glow', Glow: 'glow', Dome: 'light dome' };

export function glowTowardText(t: GlowToward, azDeg: number): string {
  const base = `${LEVEL_TEXT[glowLevel(t)]} toward ${Math.round(azDeg)}° ${compass(azDeg)}`;
  if (t.hidden) return `${base} (behind terrain)`;
  return glowLevel(t) === GlowLevel.None ? base : `${base}, ~${t.heightDeg < 1 ? t.heightDeg.toFixed(1) : Math.round(t.heightDeg)}° high`;
}

export interface MoonSample {
  t: number;
  /** Sky toward the aim with the moon, mag/arcsec². */
  mag: number;
  /** Moonlight's brightening there, mag (≤ 0). */
  deltaMag: number;
  moonAltDeg: number;
}

export interface MoonAt {
  altDeg: number;
  azDeg: number;
  illumination: number;
}

/** K&S moonlit sky toward one direction, sampled across [startMs, endMs] inclusive. */
export function moonCurve(zenithMag: number, aimAzDeg: number, aimAltDeg: number, startMs: number, endMs: number, stepMs: number, moonAt: (t: number) => MoonAt): MoonSample[] {
  const out: MoonSample[] = [];
  if (!(endMs > startMs) || stepMs <= 0) return out;
  const n = Math.ceil((endMs - startMs) / stepMs);
  for (let i = 0; i <= n; i++) {
    const t = Math.min(endMs, startMs + i * stepMs);
    const m = moonAt(t);
    const rho = separationDeg(aimAzDeg, aimAltDeg, m.azDeg, m.altDeg);
    const s = moonlitSky(zenithMag, aimAltDeg, m.altDeg, rho, m.illumination);
    out.push({ t, mag: s.mag, deltaMag: s.deltaMag, moonAltDeg: m.altDeg });
  }
  return out;
}

/** Moonlight adding less than this counts as a dark sky. */
export const MOON_DARK_DMAG = -0.1;
