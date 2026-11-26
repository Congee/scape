/** The release of each followed source for this load, remembered in localStorage across loads. Main thread only; workers are sent it. */

import { BAG3D_LATEST, BAG3D_RELEASE, bag3dRelease, SWISS_LATEST, SWISS_RELEASE, swissRelease } from '@core/lod2/releases';
import { isObject, parseJson } from '@core/io/check';
import { LatestRelease, ReleaseSource, type KnownRelease, type ReleaseMemory } from '@core/tiles/latestRelease';
import { newestOvertureRelease, OVERTURE_BUILDINGS_RELEASE, OVERTURE_TILES_LISTING } from '@core/tiles/overtureRelease';

const KEY = 'scape.releases';
/** A background check waits past the first tiles. */
const BACKGROUND_DELAY_MS = 30_000;

const FALLBACK: Record<ReleaseSource, string> = { [ReleaseSource.Overture]: OVERTURE_BUILDINGS_RELEASE, [ReleaseSource.Bag3d]: BAG3D_RELEASE, [ReleaseSource.Swiss]: SWISS_RELEASE };

const CHECK: Record<ReleaseSource, (signal: AbortSignal) => Promise<string | null>> = {
  [ReleaseSource.Overture]: async (signal) => {
    const res = await fetch(OVERTURE_TILES_LISTING, { signal });
    return res.ok ? newestOvertureRelease(await res.text(), 'buildings') : null;
  },
  // The redirect names the release; HEAD skips the tileset body.
  [ReleaseSource.Bag3d]: async (signal) => {
    const res = await fetch(BAG3D_LATEST, { method: 'HEAD', signal });
    return res.ok ? bag3dRelease(res.url) : null;
  },
  [ReleaseSource.Swiss]: async (signal) => {
    const res = await fetch(SWISS_LATEST, { signal });
    return res.ok ? swissRelease(await res.text()) : null;
  }
};

function readAll(): Record<string, unknown> {
  try {
    const v = parseJson(localStorage.getItem(KEY) ?? '{}');
    return isObject(v) ? v : {};
  } catch {
    return {};
  }
}

function memory(source: ReleaseSource): ReleaseMemory {
  return {
    get: (): KnownRelease | null => {
      const k = readAll()[source];
      return isObject(k) && typeof k.release === 'string' && typeof k.checkedAt === 'number' ? { release: k.release, checkedAt: k.checkedAt } : null;
    },
    set: (k) => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [source]: k }));
      } catch {
        // Private mode: the next load asks again.
      }
    }
  };
}

const resolvers = new Map<ReleaseSource, LatestRelease>();

function resolver(source: ReleaseSource): LatestRelease {
  let r = resolvers.get(source);
  if (!r) {
    r = new LatestRelease(FALLBACK[source], {
      check: CHECK[source],
      memory: memory(source),
      now: Date.now,
      online: () => navigator.onLine !== false,
      later: (run) => setTimeout(run, BACKGROUND_DELAY_MS)
    });
    resolvers.set(source, r);
  }
  return r;
}

/** This load's release of `source`; never rejects. */
export const sessionRelease = (source: ReleaseSource): Promise<string> => resolver(source).current();

type Listener = (source: ReleaseSource, release: string) => void;
const listeners = new Set<Listener>();

/** Called when a gone release is replaced mid-session; returns the unsubscribe. */
export function onReleaseChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** `release` of `source` answered 404: re-resolves once and tells the listeners of a replacement. */
export function releaseGone(source: ReleaseSource, release: string): void {
  void resolver(source)
    .gone(release)
    .then((next) => {
      if (next) for (const l of listeners) l(source, next);
    });
}
