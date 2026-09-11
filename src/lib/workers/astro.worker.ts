/// <reference lib="webworker" />
import { makeObserver } from '@core/astro/bodies';
import { dayCurve } from '@core/astro/dayCurve';
import { dayEvents } from '@core/astro/dayEvents';
import type { AstroRequest, AstroResponse } from './astro.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (e: MessageEvent<AstroRequest>) => {
  const { id, pin, heightAboveGroundM, startMs, endMs, goldenAltitude } = e.data;
  const obs = makeObserver(pin, heightAboveGroundM);
  const events = dayEvents(obs, startMs, endMs, { goldenAltitude, heightAboveGroundM });
  const curve = dayCurve(obs, startMs, endMs);
  const res: AstroResponse = { id, events, curve };
  const buffers = [...Object.values(curve.altitude), ...Object.values(curve.azimuth)].map((a) => a.buffer);
  scope.postMessage(res, buffers);
});
