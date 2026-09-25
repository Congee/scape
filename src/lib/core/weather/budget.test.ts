import { describe, expect, it } from 'vitest';
import { emptyBudget, rateLimited, refusal, spend, spent, succeeded } from './budget';

const T = Date.parse('2026-09-25T10:00:00Z');

describe('budget', () => {
  it('refuses past each window with headroom', () => {
    let s = spend(emptyBudget(), T, 470);
    expect(refusal(s, T, 10)).toBeNull();
    expect(refusal(s, T, 20)).toMatch(/minute/);
    expect(refusal(s, T + 60_000, 20)).toBeNull();
    for (let m = 1; m < 9; m++) s = spend(s, T + m * 60_000, 470);
    expect(refusal(s, T + 9 * 60_000, 300)).toMatch(/hourly/);
    expect(refusal(s, T + 61 * 60_000, 300)).toBeNull();
  });
  it('forgets calls older than a day', () => {
    const s = spend(spend(emptyBudget(), T, 5), T + 1441 * 60_000, 1);
    expect(spent(s, T + 1441 * 60_000)).toEqual({ minute: 1, hour: 1, day: 1 });
    expect(Object.keys(s.minutes)).toHaveLength(1);
  });
  it('backs off on 429, doubling, and resets on success', () => {
    let s = rateLimited(emptyBudget(), T);
    expect(refusal(s, T + 30_000, 1)).toMatch(/rate limited/);
    expect(refusal(s, T + 60_000, 1)).toBeNull();
    s = rateLimited(s, T + 60_000);
    expect(s.backoffUntil).toBe(T + 180_000);
    expect(succeeded(s).backoffMs).toBe(0);
  });
});
