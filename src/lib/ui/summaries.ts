import { degrees, percent } from '@core/format';
import type { MilkyWayStatus } from '@core/astro/milkyWay';
import { SightVerdict } from '@core/weather/sightline';

const signed = (deg: number, digits = 1) => `${deg >= 0 ? '+' : ''}${degrees(deg, digits)}`;

/** The Milky Way row's collapsed verdict. */
export const mwVerdict = (mw: Pick<MilkyWayStatus, 'visible'>) => (mw.visible ? 'Core visible now' : 'Core not visible now');

/** What keeps the core from counting as visible, for the expanded body. */
export function mwReasons(mw: Pick<MilkyWayStatus, 'dark' | 'coreUp' | 'moonOk' | 'sunAltDeg' | 'floorDeg' | 'moonIllumination'>): string[] {
  const out: string[] = [];
  if (!mw.dark) out.push(`sun at ${signed(mw.sunAltDeg)}`);
  if (!mw.coreUp) out.push(`core needs ${signed(mw.floorDeg)}`);
  if (!mw.moonOk) out.push(`moon up, ${percent(mw.moonIllumination, 0)} lit`);
  return out;
}

/** The Stars row's collapsed verdict: the NPF limit or what it needs. */
export const npfSummary = (npfS: number | null, focalMm: number) => (npfS ? `NPF ${npfS.toFixed(1)} s at ${focalMm} mm` : 'NPF needs the pixel count');

/** A row's own sightline verdict; Unknown is said once per list instead. */
export const rowVerdict = (v: SightVerdict | undefined) => (v === SightVerdict.Unknown ? undefined : v);

/** Whether a list needs its one "horizon unknown" note. */
export const anyUnknown = (vs: Iterable<SightVerdict | undefined>) => {
  for (const v of vs) if (v === SightVerdict.Unknown) return true;
  return false;
};
