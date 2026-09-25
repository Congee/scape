export const FogReason = { Code: 'Code', Visibility: 'Visibility', Spread: 'Spread' } as const;
export type FogReason = (typeof FogReason)[keyof typeof FogReason];

export const FOG_VISIBILITY_M = 1000;
export const FOG_SPREAD_C = 1;
/** Low cloud share that makes a saturated surface read as fog rather than dew. */
export const FOG_LOW_CLOUD = 50;

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
  Visibility: 'visibility < 1 km',
  Spread: 'dew-point spread < 1 °C with low cloud'
};
