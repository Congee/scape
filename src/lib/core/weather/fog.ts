export const FogReason = { Code: 'Code', Visibility: 'Visibility', Spread: 'Spread' } as const;
export type FogReason = (typeof FogReason)[keyof typeof FogReason];

/** Fit by scripts/weather/fogcal.ts on METAR fog or mist at sunrise and sunset hours. */
export const FOG_VISIBILITY_M = 5000;
export const FOG_SPREAD_C = 1;
/** Low cloud share that makes a saturated surface read as fog rather than dew. */
export const FOG_LOW_CLOUD = 80;

export interface FogInput {
  code: number;
  visibilityM: number;
  tempC: number;
  dewC: number;
  lowCloud: number;
}

/** Which fog signs fired; NaN inputs never fire. */
export function fogReasons(x: FogInput): FogReason[] {
  const out: FogReason[] = [];
  if (x.code === 45 || x.code === 48) out.push(FogReason.Code);
  if (x.visibilityM < FOG_VISIBILITY_M) out.push(FogReason.Visibility);
  if (x.tempC - x.dewC < FOG_SPREAD_C && x.lowCloud >= FOG_LOW_CLOUD) out.push(FogReason.Spread);
  return out;
}

export const FOG_TEXT: Record<FogReason, string> = {
  Code: 'fog code 45/48',
  Visibility: `visibility < ${FOG_VISIBILITY_M / 1000} km`,
  Spread: `dew-point spread < ${FOG_SPREAD_C} °C with low cloud`
};
