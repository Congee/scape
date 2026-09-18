/** Fuzzy matching for the bundled gear catalogue. Pure: the rows come from the caller. */

/**
 * Loose matching: "a7 iv", "a7iv", "z8", "s5ii", "24-70 2.8" all reach their rows.
 * Letter/digit boundaries become spaces so "Z 8" and "z8" tokenise alike.
 */
export function normalizeGearText(s: string): string {
  return s
    .toLowerCase()
    .replace(/α/g, 'a')
    .replace(/f\//g, 'f')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function gearTokens(query: string): string[] {
  return normalizeGearText(query).split(' ').filter(Boolean);
}

/**
 * Total match score, or -1 when a token is missing. Tokens starting a word count double,
 * and the whole query landing as one run of words outranks the same tokens scattered about.
 */
export function scoreGear(hay: string, tokens: string[]): number {
  let total = 0;
  for (const t of tokens) {
    const at = hay.indexOf(t);
    if (at < 0) return -1;
    total += at === 0 || hay[at - 1] === ' ' ? 2 : 1;
  }
  return ` ${hay} `.includes(` ${tokens.join(' ')} `) ? total + 2 * tokens.length : total;
}

/** The best `limit` rows for `tokens`, `bonus` nudging preferred rows up the list. */
export function searchGear<T>(rows: readonly T[], hay: (r: T) => string, tokens: string[], bonus: (r: T) => number, limit: number): T[] {
  if (tokens.length === 0) return [];
  return rows
    .map((r) => ({ r, s: scoreGear(normalizeGearText(hay(r)), tokens) }))
    .filter((x) => x.s >= 0)
    .map((x) => ({ r: x.r, s: x.s + bonus(x.r) }))
    .toSorted((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r);
}

/**
 * Long-end f-number encoded in a zoom's model name — `f/4.5-5.6L`, `F5.6-8`, `mmF4.5-6.3` — or null
 * for a constant-aperture lens. A range followed by `mm` is the focal range, not the aperture.
 */
export function longApertureOf(model: string): number | null {
  for (const m of model.matchAll(/[fF]\/?\d+(?:\.\d+)?-(\d+(?:\.\d+)?)/g)) {
    const end = (m.index ?? 0) + m[0].length;
    if (model.slice(end, end + 2) === 'mm') continue;
    return Number(m[1]);
  }
  return null;
}
