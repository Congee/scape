/** Open-Meteo's free-tier limits, weighted calls. */
export const LIMITS = { minute: 600, hour: 5000, day: 10000 } as const;
/** Headroom kept below each limit; the IP may be shared. */
const SHARE = 0.8;
const MIN_MS = 60_000;
const BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 3_600_000;

export interface BudgetState {
  /** Weighted calls per minute index (epoch ms / 60 s). */
  minutes: Record<number, number>;
  backoffUntil: number;
  backoffMs: number;
}

export const emptyBudget = (): BudgetState => ({ minutes: {}, backoffUntil: 0, backoffMs: 0 });

function sum(s: BudgetState, now: number, spanMin: number): number {
  const m = Math.floor(now / MIN_MS);
  let t = 0;
  for (const k in s.minutes) if (+k > m - spanMin) t += s.minutes[k];
  return t;
}

/** Why a request of `weight` may not go now, or null when it may. */
export function refusal(s: BudgetState, now: number, weight: number): string | null {
  if (now < s.backoffUntil) return `rate limited, retry after ${new Date(s.backoffUntil).toISOString().slice(11, 16)} UTC`;
  if (sum(s, now, 1) + weight > LIMITS.minute * SHARE) return 'per-minute budget spent';
  if (sum(s, now, 60) + weight > LIMITS.hour * SHARE) return 'hourly budget spent';
  if (sum(s, now, 1440) + weight > LIMITS.day * SHARE) return 'daily budget spent';
  return null;
}

export function spend(s: BudgetState, now: number, weight: number): BudgetState {
  const m = Math.floor(now / MIN_MS);
  const minutes: Record<number, number> = {};
  for (const k in s.minutes) if (+k > m - 1440) minutes[k] = s.minutes[k];
  minutes[m] = (minutes[m] ?? 0) + weight;
  return { ...s, minutes };
}

/** A 429 doubles the pause, from a minute up to an hour. */
export function rateLimited(s: BudgetState, now: number): BudgetState {
  const backoffMs = Math.min(MAX_BACKOFF_MS, s.backoffMs ? s.backoffMs * 2 : BACKOFF_MS);
  return { ...s, backoffMs, backoffUntil: now + backoffMs };
}

export const succeeded = (s: BudgetState): BudgetState => (s.backoffMs ? { ...s, backoffMs: 0, backoffUntil: 0 } : s);

export const spent = (s: BudgetState, now: number) => ({ minute: sum(s, now, 1), hour: sum(s, now, 60), day: sum(s, now, 1440) });
