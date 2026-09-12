/** Ranking for the bundled offline place index. */

export interface City {
  name: string;
  lat: number;
  lng: number;
  country: string;
  population: number;
}

// Folding 70k names on every keystroke is the hot path.
const folded = new Map<string, string>();

/** Lowercase and strip diacritics, so "zermatt" matches "Zermatt" and "ае" matches "áé". */
export function foldName(s: string): string {
  const hit = folded.get(s);
  if (hit !== undefined) return hit;
  const f = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  folded.set(s, f);
  return f;
}

const Rank = { Prefix: 0, WordStart: 1, Substring: 2, None: 3 } as const;
type Rank = (typeof Rank)[keyof typeof Rank];

function rank(name: string, query: string): Rank {
  const i = name.indexOf(query);
  if (i < 0) return Rank.None;
  if (i === 0) return Rank.Prefix;
  return /[\s'\-,.()/]/.test(name[i - 1]) ? Rank.WordStart : Rank.Substring;
}

/** Best matches for `query`: prefixes first, then word starts, then substrings; ties by population. */
export function rankCities(query: string, cities: City[], limit = 8): City[] {
  const q = foldName(query.trim());
  if (!q) return [];
  const hits: { city: City; rank: Rank }[] = [];
  for (const city of cities) {
    const r = rank(foldName(city.name), q);
    if (r !== Rank.None) hits.push({ city, rank: r });
  }
  hits.sort((a, b) => a.rank - b.rank || b.city.population - a.city.population);
  return hits.slice(0, limit).map((h) => h.city);
}
