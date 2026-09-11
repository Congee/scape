const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
    cache.set(key, f);
  }
  return f;
}

/** "6:33 AM" or "06:33"; with seconds when asked. */
export function formatTime(ms: number, tz: string, hour12: boolean, seconds = false): string {
  const opts: Intl.DateTimeFormatOptions = hour12
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  if (seconds) opts.second = '2-digit';
  return formatter(tz, opts).format(ms);
}

/** "Fri, Sep 11, 2026" */
export function formatDate(ms: number, tz: string): string {
  return formatter(tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(ms);
}

/** "Sep 11" */
export function formatDateShort(ms: number, tz: string): string {
  return formatter(tz, { month: 'short', day: 'numeric' }).format(ms);
}

export function formatDateTime(ms: number, tz: string, hour12: boolean): string {
  return `${formatDate(ms, tz)} ${formatTime(ms, tz, hour12)}`;
}
