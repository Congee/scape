/** Which quantity the other two determine; fps is always an input. */
export const TimelapseSolve = { Interval: 'Interval', Clip: 'Clip', Event: 'Event' } as const;
export type TimelapseSolve = (typeof TimelapseSolve)[keyof typeof TimelapseSolve];

export interface TimelapseInput {
  intervalS: number;
  clipS: number;
  eventS: number;
  fps: number;
}

export interface Timelapse extends TimelapseInput {
  shots: number;
  /** Real seconds per second of clip. */
  speedup: number;
}

/** PhotoPills convention: shots = event / interval = clip × fps. */
export function timelapse(input: TimelapseInput, solve: TimelapseSolve): Timelapse {
  const { fps } = input;
  let { intervalS, clipS, eventS } = input;
  if (solve === TimelapseSolve.Interval) intervalS = eventS / (clipS * fps);
  else if (solve === TimelapseSolve.Clip) clipS = eventS / intervalS / fps;
  else eventS = clipS * fps * intervalS;
  return { intervalS, clipS, eventS, fps, shots: Math.round(clipS * fps), speedup: intervalS * fps };
}

/** Raw file size estimate: 14-bit samples, uncompressed. */
export const RAW_BITS_PER_PIXEL = 14;
export function rawBytesPerShot(pixels: number, bitsPerPixel = RAW_BITS_PER_PIXEL): number {
  return (pixels * bitsPerPixel) / 8;
}

/** Epoch ms shown at step `k` of a sequence of `shots`, wrapping to the start. */
export function sequenceTime(startMs: number, intervalS: number, shots: number, k: number): number {
  const n = Math.max(1, Math.round(shots));
  return startMs + (((k % n) + n) % n) * intervalS * 1000;
}
