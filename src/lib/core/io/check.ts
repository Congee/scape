import type { Digits, LngLat } from '@core/geo/geodesy';

/** Reads an untrusted value (storage, a file) as T; undefined when it does not fit. */
export type Check<T> = (v: unknown) => T | undefined;

/** A key that may be absent; a bad value is dropped like a missing one. */
export interface Optional<T> {
  readonly optional: Check<T>;
}

export const optional = <T>(check: Check<T>): Optional<T> => ({ optional: check });

/** One check per key of T, so a field added to T without a check fails to compile. */
export type Checks<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? Optional<Exclude<T[K], undefined>> : Check<T[K]>;
};

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const num: Check<number> = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export const positive: Check<number> = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
export const str: Check<string> = (v) => (typeof v === 'string' ? v : undefined);
export const bool: Check<boolean> = (v) => (typeof v === 'boolean' ? v : undefined);

export const inRange =
  (lo: number, hi: number): Check<number> =>
  (v) => (typeof v === 'number' && v >= lo && v <= hi ? v : undefined);

/** Membership in an `as const` enum object. */
export function oneOf<const O extends Record<string, string | number>>(o: O): Check<O[keyof O]> {
  const values: readonly unknown[] = Object.values(o);
  return (v) => (values.includes(v) ? (v as O[keyof O]) : undefined);
}

export const nullable =
  <T>(check: Check<T>): Check<T | null> =>
  (v) => (v === null ? null : check(v));

/** Keeps the items that pass, so one bad entry does not cost the whole list. */
export const listOf =
  <T>(check: Check<T>): Check<T[]> =>
  (v) => {
    if (!Array.isArray(v)) return undefined;
    const out: T[] = [];
    for (const item of v) {
      const r = check(item);
      if (r !== undefined) out.push(r);
    }
    return out;
  };

/** An object whose required keys all pass; unknown keys are dropped. */
export function record<T>(checks: Checks<T>): Check<T> {
  const entries = Object.entries(checks) as [string, Check<unknown> | Optional<unknown>][];
  return (v) => {
    if (!isObject(v)) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, c] of entries) {
      const r = typeof c === 'function' ? c(v[k]) : c.optional(v[k]);
      if (r !== undefined) out[k] = r;
      else if (typeof c === 'function') return undefined;
    }
    return out as T;
  };
}

/** Each field of `saved` that passes its check, else `fallback`'s; unknown keys are dropped. */
export function checkFields<T>(checks: Checks<T>, saved: unknown, fallback: NoInfer<T>): T {
  const s = isObject(saved) ? saved : {};
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(checks) as [keyof T & string, Check<unknown> | Optional<unknown>][]) {
    const r = typeof c === 'function' ? c(s[k]) : c.optional(s[k]);
    const v = r !== undefined ? r : fallback[k];
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/** JSON's value, or undefined when the text is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** An IANA zone name `Intl` accepts. */
export const timeZone: Check<string> = (v) => {
  if (typeof v !== 'string' || !v) return undefined;
  try {
    Intl.DateTimeFormat('en', { timeZone: v });
    return v;
  } catch {
    return undefined;
  }
};

export const digits = record<Digits>({ lat: num, lng: num });

export const lngLat = record<LngLat>({ lng: num, lat: inRange(-90, 90), digits: optional(digits) });
