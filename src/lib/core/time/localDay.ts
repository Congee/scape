/** Time-zone aware calendar helpers built on Intl only (no library, works offline). */

export interface DayBounds {
  /** UTC instant of local 00:00 on the day containing `instant`. */
  start: Date;
  /** UTC instant of local 00:00 on the following day. */
  end: Date;
  /** ISO calendar date, e.g. "2026-09-11". */
  isoDate: string;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(instant: Date, tz: string): LocalParts {
  const p: Record<string, number> = {};
  for (const part of partsFormatter(tz).formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour === 24 ? 0 : p.hour,
    minute: p.minute,
    second: p.second
  };
}

/** Offset of `tz` from UTC at `instant`, in milliseconds (east positive). */
export function tzOffsetMs(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight for the given calendar date in `tz`. Handles DST edges. */
export function localMidnight(year: number, month: number, day: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  // Second pass catches a DST transition between guess and t.
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

export function dayBounds(instant: Date, tz: string): DayBounds {
  const p = localParts(instant, tz);
  const start = localMidnight(p.year, p.month, p.day, tz);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz);
  return { start, end, isoDate: isoDate(p) };
}

export function isoDate(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Shift `instant` by whole local days, keeping the local wall-clock time where possible. */
export function addLocalDays(instant: Date, days: number, tz: string): Date {
  const p = localParts(instant, tz);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  const midnight = localMidnight(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    tz
  );
  const wall = ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
  return new Date(midnight.getTime() + wall);
}

/** Set the local wall-clock time (seconds since local midnight) on the day containing `instant`. */
export function withLocalTime(instant: Date, secondsSinceMidnight: number, tz: string): Date {
  const { start } = dayBounds(instant, tz);
  return new Date(start.getTime() + secondsSinceMidnight * 1000);
}

/** The local noon-to-noon night containing `instant`. */
export function noonToNoon(instant: Date, tz: string): { startMs: number; endMs: number } {
  const NOON_S = 12 * 3600;
  let start = withLocalTime(instant, NOON_S, tz);
  if (start.getTime() > instant.getTime()) start = withLocalTime(addLocalDays(instant, -1, tz), NOON_S, tz);
  return { startMs: start.getTime(), endMs: addLocalDays(start, 1, tz).getTime() };
}

/** Set the local calendar date, keeping the wall-clock time. `iso` is "YYYY-MM-DD". */
export function withLocalDate(instant: Date, iso: string, tz: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  const p = localParts(instant, tz);
  const midnight = localMidnight(y, m, d, tz);
  const wall = ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
  return new Date(midnight.getTime() + wall);
}

/** Short UTC offset label such as "GMT-4" or "GMT+5:30". */
export function offsetLabel(instant: Date, tz: string): string {
  const min = Math.round(tzOffsetMs(instant, tz) / 60000);
  const sign = min < 0 ? '-' : '+';
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  return `GMT${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}
