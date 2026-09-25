export const FogClass = { None: 'None', Mist: 'Mist', Fog: 'Fog' } as const;
export type FogClass = (typeof FogClass)[keyof typeof FogClass];

export const FogReason = { Code: 'Code', FogVisibility: 'FogVisibility', MistVisibility: 'MistVisibility', Spread: 'Spread' } as const;
export type FogReason = (typeof FogReason)[keyof typeof FogReason];

/** Fit by scripts/weather/fogcal.ts on METAR fog and mist at sunrise and sunset hours. */
export const FOG_VISIBILITY_M = 1000;
export const MIST_VISIBILITY_M = 5000;
export const FOG_SPREAD_C = 1;
/** Low cloud share that makes a saturated surface read as fog rather than dew. */
export const FOG_LOW_CLOUD = 80;
/** What the spread sign alone means when the model serves no visibility; fogcal scored both. */
export const BLIND_SPREAD_CLASS: FogClass = FogClass.Mist;

export interface FogInput {
  code: number;
  visibilityM: number;
  tempC: number;
  dewC: number;
  lowCloud: number;
}

export interface FogSigns {
  cls: FogClass;
  reasons: FogReason[];
}

/** Fog or mist, and which signs fired; NaN inputs never fire. */
export function fogSigns(x: FogInput, blind: FogClass = BLIND_SPREAD_CLASS): FogSigns {
  const reasons: FogReason[] = [];
  if (x.code === 45 || x.code === 48) reasons.push(FogReason.Code);
  if (x.visibilityM < FOG_VISIBILITY_M) reasons.push(FogReason.FogVisibility);
  else if (x.visibilityM < MIST_VISIBILITY_M) reasons.push(FogReason.MistVisibility);
  const spread = x.tempC - x.dewC < FOG_SPREAD_C && x.lowCloud >= FOG_LOW_CLOUD;
  if (spread) reasons.push(FogReason.Spread);
  const fog = reasons.includes(FogReason.Code) || reasons.includes(FogReason.FogVisibility) || (spread && Number.isNaN(x.visibilityM) && blind === FogClass.Fog);
  return { cls: fog ? FogClass.Fog : reasons.length ? FogClass.Mist : FogClass.None, reasons };
}

export const FOG_TEXT: Record<FogReason, string> = {
  Code: 'fog code 45/48',
  FogVisibility: `visibility < ${FOG_VISIBILITY_M / 1000} km`,
  MistVisibility: `visibility ${FOG_VISIBILITY_M / 1000}–${MIST_VISIBILITY_M / 1000} km`,
  Spread: `dew-point spread < ${FOG_SPREAD_C} °C with low cloud`
};

export const FOG_CLASS_TEXT: Record<FogClass, string> = { None: 'Clear', Mist: 'Mist', Fog: 'Fog' };
