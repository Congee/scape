import { useEffect, useState } from 'react';
import { bboxCentre, type Bbox } from '@core/geo/bbox';
import { formatLngLat } from '@core/geo/coords';
import { distanceM } from '@core/geo/geodesy';
import { bytes } from '@core/format';
import { BUILDINGS_DEFAULT_MAX_TILES, BUILDINGS_ZOOM, buildingsByDefault } from '@core/tiles/buildingsRegion';
import { offlineSources, SAT_OFFLINE_MIN_ZOOM, SAT_OFFLINE_SOURCE, SAT_OFFLINE_ZOOMS } from '@core/tiles/satellite';
import { PmFlavor } from '@data/basemaps';
import { OVERTURE_BUILDINGS_RELEASE, OVERTURE_BUILDINGS_URL } from '@data/buildingTiles';
import { BASEMAP_DEFAULT_MAX_TILES, basemapByDefault, isPmtilesUrl, OFM_STYLE, OFM_TILEJSON } from '@data/openfreemap';
import { PROTOMAPS_BUILD } from '@data/protomaps';
import { demZoom, TERRAIN_TILE_URL } from '@data/terrainTiles';
import { defaultBasemapSourceUrl, GEOID_DOWNLOAD_URL, JobState, offlineStore, useOffline, warmStyleAssets, type DownloadJob } from '@state/offline';
import { settingsStore, useSettings } from '@state/settings';
import { EARTHDATA_SIGNUP, laadsYearUrl, tilesNear, VIIRS_FIRST_YEAR, VIIRS_MARGIN_KM } from '@core/sky/viirs';
import { clearGibs, offerYear } from '@state/skyglow';
import { useWorld } from '@state/world';
import { ArchiveKind, type ArchiveMeta, type Estimate, type RegionSpec } from '@workers/region.protocol';

const BASEMAP_ZOOMS = [10, 11, 12, 13, 14, 15];
const DEFAULT_MAX_ZOOM = 14;
const TERRAIN_MIN_ZOOM = demZoom(6);
const TERRAIN_MAX_ZOOM = demZoom(14);
const FLAVORS: PmFlavor[] = Object.values(PmFlavor);

const BasemapSource = { OpenFreeMap: 'openfreemap', Protomaps: 'protomaps' } as const;
type BasemapSource = (typeof BasemapSource)[keyof typeof BasemapSource];

const sourceOf = (url: string): BasemapSource => (isPmtilesUrl(url) ? BasemapSource.Protomaps : BasemapSource.OpenFreeMap);
const defaultSourceUrl = (s: BasemapSource) => (s === BasemapSource.Protomaps ? defaultBasemapSourceUrl() : OFM_TILEJSON);

const KIND_LABEL: Record<ArchiveKind, string> = { [ArchiveKind.Basemap]: 'Basemap', [ArchiveKind.Terrain]: 'Terrain', [ArchiveKind.Buildings]: 'Buildings', [ArchiveKind.Satellite]: 'Satellite' };
const SAT_DEFAULT_MAX_ZOOM = 16;
const SAT_OFFLINE_NAMES = offlineSources()
  .map((s) => s.name)
  .join(', ');

const STATE_LABEL: Record<JobState, string> = {
  [JobState.Estimating]: 'Estimating',
  [JobState.Running]: 'Downloading',
  [JobState.Done]: 'Done',
  [JobState.Error]: 'Failed',
  [JobState.Cancelled]: 'Cancelled'
};

const isSafari = () => /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

const km = (m: number) => (m / 1000).toFixed(m < 100_000 ? 1 : 0);

/** Width along the mid-latitude and height along the mid-longitude, so crossing boxes read right. */
function sizeLabel(b: Bbox): string {
  const c = bboxCentre(b);
  const w = 2 * distanceM({ lng: b.west, lat: c.lat }, { lng: c.lng, lat: c.lat });
  const h = distanceM({ lng: c.lng, lat: b.south }, { lng: c.lng, lat: b.north });
  return `${km(w)} × ${km(h)} km`;
}

/** The build day baked into a Protomaps daily URL, "20260912" → "2026-09-12". */
function buildDate(url: string): string {
  const m = /(\d{4})(\d{2})(\d{2})/.exec(url);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function estimateLabel(e: Estimate): string {
  const date = e.build ?? buildDate(e.sourceUrl);
  const size = `${e.exact ? '' : '~'}${bytes(e.bytes)}`;
  return `${e.tileCount.toLocaleString()} tiles · ${size}${date ? ` · build ${date}` : ''}`;
}

const todayName = () => `Region ${new Date().toISOString().slice(0, 10)}`;

/** A dated Protomaps build is refreshed to today's; any other source is reused as is. */
const freshSource = (a: ArchiveMeta) =>
  a.kind === ArchiveKind.Terrain ? TERRAIN_TILE_URL : a.kind === ArchiveKind.Satellite ? SAT_OFFLINE_SOURCE : a.kind === ArchiveKind.Buildings ? OVERTURE_BUILDINGS_URL : a.sourceUrl.startsWith(PROTOMAPS_BUILD) ? defaultBasemapSourceUrl() : a.sourceUrl;

const ZOOMS: Record<ArchiveKind, [number, number] | null> = {
  [ArchiveKind.Basemap]: null,
  [ArchiveKind.Terrain]: [TERRAIN_MIN_ZOOM, TERRAIN_MAX_ZOOM],
  [ArchiveKind.Buildings]: [BUILDINGS_ZOOM, BUILDINGS_ZOOM],
  [ArchiveKind.Satellite]: null
};

export function OfflinePanel() {
  const supported = useOffline((s) => s.supported);
  const archives = useOffline((s) => s.archives);
  const jobs = useOffline((s) => s.jobs);
  const storage = useOffline((s) => s.storage);
  const draft = useOffline((s) => s.draft);
  const drawing = useOffline((s) => s.drawing);
  const coordFormat = useSettings((s) => s.coordFormat);
  const basemapId = useSettings((s) => s.basemapId);
  const offlineFlavor = useSettings((s) => s.offlineFlavor);

  const [name, setName] = useState(todayName);
  const [maxZoom, setMaxZoom] = useState(DEFAULT_MAX_ZOOM);
  const [satMaxZoom, setSatMaxZoom] = useState(SAT_DEFAULT_MAX_ZOOM);
  const [sourceUrl, setSourceUrl] = useState(OFM_TILEJSON);
  const [estimates, setEstimates] = useState<Partial<Record<ArchiveKind, Estimate>>>({});
  const [error, setError] = useState<string | null>(null);
  /** Null follows the region's size. */
  const [withBuildings, setWithBuildings] = useState<boolean | null>(null);
  const [withBasemap, setWithBasemap] = useState<boolean | null>(null);

  useEffect(() => {
    const s = offlineStore.getState();
    if (!s.loaded) void s.load();
    void s.refreshGibs();
  }, []);

  const o = offlineStore.getState();

  if (!supported) {
    return (
      <div className="layers offline">
        <p className="error">This browser has no private file storage; offline regions are unavailable.</p>
      </div>
    );
  }

  const spec = (kind: ArchiveKind, bbox: Bbox): RegionSpec => {
    const [minZoom, maxZ] = ZOOMS[kind] ?? (kind === ArchiveKind.Satellite ? [SAT_OFFLINE_MIN_ZOOM, satMaxZoom] : [0, maxZoom]);
    const url = sourceUrl.trim() || OFM_TILEJSON;
    return {
      kind,
      name: name.trim() || todayName(),
      bbox,
      minZoom,
      maxZoom: maxZ,
      sourceUrl: kind === ArchiveKind.Terrain ? TERRAIN_TILE_URL : kind === ArchiveKind.Buildings ? OVERTURE_BUILDINGS_URL : kind === ArchiveKind.Satellite ? SAT_OFFLINE_SOURCE : url,
      ...(kind === ArchiveKind.Basemap && !isPmtilesUrl(url) && { styleUrl: OFM_STYLE })
    };
  };
  const buildingsOn = draft ? (withBuildings ?? buildingsByDefault(draft)) : false;
  const basemapOn = draft ? (withBasemap ?? basemapByDefault(draft, maxZoom)) : false;

  const runEstimate = async (kind: ArchiveKind) => {
    if (!draft) return;
    setError(null);
    try {
      const e = await o.estimate(spec(kind, draft));
      setEstimates((prev) => ({ ...prev, [kind]: e }));
      // Show the build that actually answered when the day's build is not out yet.
      if (kind === ArchiveKind.Basemap && e.sourceUrl !== sourceUrl) setSourceUrl(e.sourceUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const start = (kind: ArchiveKind) => {
    if (!draft) return;
    setError(null);
    o.download(spec(kind, draft));
    if (kind === ArchiveKind.Terrain && buildingsOn) o.download(spec(ArchiveKind.Buildings, draft));
    if (kind === ArchiveKind.Terrain && basemapOn) o.download(spec(ArchiveKind.Basemap, draft));
  };

  const update = (a: ArchiveMeta) => {
    o.download({
      kind: a.kind,
      name: a.name,
      bbox: a.bbox,
      minZoom: a.minZoom,
      maxZoom: a.maxZoom,
      replaces: a.id,
      sourceUrl: freshSource(a),
      ...(a.style && { styleUrl: a.style })
    });
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      await o.importArchive(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = (a: ArchiveMeta) => {
    if (window.confirm(`Delete “${a.name}”? The tiles are removed from this device.`)) void o.remove(a.id);
  };

  // The flavor only styles Protomaps archives; OpenFreeMap ones carry their own style.
  const hasProtomapsArchive = archives.some((a) => a.kind === ArchiveKind.Basemap && !a.style);
  const source = sourceOf(sourceUrl);
  const basemapEstimate = estimates[ArchiveKind.Basemap];
  const terrainEstimate = estimates[ArchiveKind.Terrain];
  const buildingsEstimate = estimates[ArchiveKind.Buildings];
  const satelliteEstimate = estimates[ArchiveKind.Satellite];

  return (
    <div className="layers offline">
      <h3>Storage</h3>
      <p className="muted hint">{storage ? `Used ${bytes(storage.usage)} of ${bytes(storage.quota)}` : 'Storage use is unknown in this browser.'}</p>
      {storage?.persisted ? (
        <p className="muted hint">Storage is persistent; the browser will not evict these regions on its own.</p>
      ) : (
        <div className="actions">
          <button onClick={() => void o.requestPersist()}>Keep data persistent</button>
        </div>
      )}
      {isSafari() && <p className="muted hint">Safari can purge site data after a week without a visit; re-download if regions disappear.</p>}

      <h3>Region</h3>
      {draft ? (
        <div className="kv">
          <span className="k">Corners</span>
          <b className="v">
            {formatLngLat({ lng: draft.west, lat: draft.south }, coordFormat)}
            <br />
            {formatLngLat({ lng: draft.east, lat: draft.north }, coordFormat)}
          </b>
          <span className="k">Size</span>
          <b className="v">{sizeLabel(draft)}</b>
        </div>
      ) : (
        <p className="muted hint">No region</p>
      )}
      <div className="actions">
        <button onClick={() => o.takeMapView()}>Use the map view</button>
        <button className={drawing ? 'on' : ''} aria-pressed={drawing} onClick={() => o.setDrawing(!drawing)}>
          Draw on the map
        </button>
        <button onClick={() => o.setDraft(null)} disabled={!draft}>
          Clear
        </button>
      </div>
      {drawing && <p className="muted hint">Drag a rectangle on the map; Esc cancels.</p>}

      <h3>Download</h3>
      <div className="field-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={todayName()} aria-label="Name for the region" />
      </div>
      <div className="field">
        <span>Basemap</span>
        <select value={maxZoom} onChange={(e) => setMaxZoom(Number(e.target.value))} aria-label="Highest basemap zoom">
          {BASEMAP_ZOOMS.map((z) => (
            <option key={z} value={z}>
              to zoom {z}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span>Source</span>
        <select
          value={source}
          onChange={(e) => {
            setSourceUrl(defaultSourceUrl(e.target.value as BasemapSource));
            setEstimates(({ [ArchiveKind.Basemap]: _, ...rest }) => rest);
          }}
          aria-label="Basemap source"
        >
          <option value={BasemapSource.OpenFreeMap}>OpenFreeMap</option>
          <option value={BasemapSource.Protomaps}>Protomaps PMTiles</option>
        </select>
      </div>
      <div className="field-row">
        <input
          className="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          spellCheck={false}
          aria-label="Basemap source URL"
          title={source === BasemapSource.Protomaps ? 'PMTiles archive the region is cut from; it must allow cross-origin range requests' : 'TileJSON whose vector tiles are packed one by one'}
        />
      </div>
      <p className="muted hint">
        {source === BasemapSource.Protomaps
          ? 'The default Protomaps build answers only local development origins (localhost:5173 and :3000); elsewhere use an archive that allows cross-origin range requests.'
          : 'OpenFreeMap tiles are packed one by one with the Liberty style, its icons and Latin, Greek and Cyrillic labels.'}
      </p>
      <div className="actions">
        <button onClick={() => void runEstimate(ArchiveKind.Basemap)} disabled={!draft}>
          Estimate
        </button>
        <button onClick={() => start(ArchiveKind.Basemap)} disabled={!draft}>
          Download
        </button>
        {basemapEstimate && <span className="muted">{estimateLabel(basemapEstimate)}</span>}
      </div>
      <label className="toggle">
        <input type="checkbox" checked={basemapOn} disabled={!draft} onChange={(e) => setWithBasemap(e.target.checked)} />
        <span>Include in the terrain download (on by default up to {BASEMAP_DEFAULT_MAX_TILES} tiles)</span>
      </label>
      <div className="field">
        <span>Terrain</span>
        <span className="muted">
          zoom {TERRAIN_MIN_ZOOM}–{TERRAIN_MAX_ZOOM} (about 10 m)
        </span>
      </div>
      <div className="actions">
        <button onClick={() => void runEstimate(ArchiveKind.Terrain)} disabled={!draft}>
          Estimate
        </button>
        <button onClick={() => start(ArchiveKind.Terrain)} disabled={!draft}>
          Download
        </button>
        {terrainEstimate && <span className="muted">{estimateLabel(terrainEstimate)}</span>}
      </div>
      <div className="field">
        <span>Buildings</span>
        <span className="muted">
          zoom {BUILDINGS_ZOOM}, Overture {OVERTURE_BUILDINGS_RELEASE}
        </span>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={buildingsOn} disabled={!draft} onChange={(e) => setWithBuildings(e.target.checked)} />
        <span>Download with the terrain (on by default up to {BUILDINGS_DEFAULT_MAX_TILES} tiles; a city tile is about 300 KB)</span>
      </label>
      <div className="actions">
        <button onClick={() => void runEstimate(ArchiveKind.Buildings)} disabled={!draft}>
          Estimate
        </button>
        <button onClick={() => start(ArchiveKind.Buildings)} disabled={!draft}>
          Download
        </button>
        {buildingsEstimate && <span className="muted">{estimateLabel(buildingsEstimate)}</span>}
      </div>
      <div className="field">
        <span>Satellite</span>
        <select
          value={satMaxZoom}
          onChange={(e) => {
            setSatMaxZoom(Number(e.target.value));
            setEstimates(({ [ArchiveKind.Satellite]: _, ...rest }) => rest);
          }}
          aria-label="Highest satellite zoom"
        >
          {SAT_OFFLINE_ZOOMS.map((z) => (
            <option key={z} value={z}>
              zoom {SAT_OFFLINE_MIN_ZOOM}–{z}
            </option>
          ))}
        </select>
      </div>
      <p className="muted hint" title={SAT_OFFLINE_NAMES}>
        Only national aerial photos whose licence allows offline copies are packed; MapTiler, Esri, and the Dutch, Swiss, Japanese, USGS (to z16), SC, DE and MO photos stay online.
      </p>
      <div className="actions" data-offline="satellite">
        <button onClick={() => void runEstimate(ArchiveKind.Satellite)} disabled={!draft}>
          Estimate
        </button>
        <button onClick={() => start(ArchiveKind.Satellite)} disabled={!draft}>
          Download
        </button>
        {satelliteEstimate && <span className="muted">{estimateLabel(satelliteEstimate)}</span>}
      </div>
      {error && <p className="error">{error}</p>}

      {jobs.length > 0 && (
        <>
          <h3>Downloads</h3>
          <ul className="list">
            {jobs.map((j) => (
              <Job key={j.id} job={j} />
            ))}
          </ul>
        </>
      )}

      <h3>Saved regions</h3>
      {archives.length === 0 && <p className="muted hint">No regions on this device yet.</p>}
      <ul className="list">
        {archives.map((a) => (
          <li key={a.id} className="archive">
            <div className="head">
              <input defaultValue={a.name} onBlur={(e) => void o.rename(a.id, e.target.value.trim() || a.name)} aria-label="Region name" />
              <span className="chip">{KIND_LABEL[a.kind]}</span>
            </div>
            <span className="detail">
              {formatLngLat(bboxCentre(a.bbox), coordFormat)} · {sizeLabel(a.bbox)} · zoom {a.minZoom}–{a.maxZoom} · {bytes(a.bytes)} · {a.downloadedAt.slice(0, 10)}
            </span>
            <div className="actions">
              {a.kind === ArchiveKind.Basemap &&
                (basemapId === `opfs:${a.id}` ? (
                  <span className="muted">In use</span>
                ) : (
                  <button className="link" onClick={() => settingsStore.getState().update({ basemapId: `opfs:${a.id}` })}>
                    Use as basemap
                  </button>
                ))}
              <button className="link" onClick={() => update(a)} title="Download the same region again from a fresh build">
                Update
              </button>
              <button className="link" onClick={() => void o.exportArchive(a.id)}>
                Export
              </button>
              <button className="link" onClick={() => remove(a)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {hasProtomapsArchive && (
        <label className="toggle">
          <span>Basemap style</span>
          <select
            value={offlineFlavor}
            onChange={(e) => {
              const flavor = e.target.value as PmFlavor;
              settingsStore.getState().update({ offlineFlavor: flavor });
              warmStyleAssets(flavor);
            }}
            title="Protomaps style flavor for offline basemaps"
          >
            {FLAVORS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      )}

      <h3>Import</h3>
      <label className="file">
        <input type="file" accept=".pmtiles" onChange={(e) => void importFile(e.target.files?.[0])} />
        Import a .pmtiles file
      </label>

      <ViirsSection />

      <GibsSection />

      <GeoidSection />
    </div>
  );
}

const TileState = { Have: 'have', Missing: 'missing', Ocean: 'ocean' } as const;
type TileState = (typeof TileState)[keyof typeof TileState];

function ViirsSection() {
  const viirs = useOffline((s) => s.viirs);
  const archives = useOffline((s) => s.archives);
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const [year, setYear] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const o = offlineStore.getState();
  const y = year ?? offerYear(viirs);
  const listed = viirs.listings[y];
  const have = new Set(viirs.tiles.filter((t) => t.year === y).map((t) => t.tile));
  const need = tilesNear(pin2 ? [pin, pin2] : [pin], archives.map((a) => a.bbox));
  const stateOf = (t: string): TileState => (have.has(t) ? TileState.Have : listed && !listed.includes(t) ? TileState.Ocean : TileState.Missing);
  const years = [...new Set(viirs.tiles.map((t) => t.year))].toSorted((a, b) => b - a);

  const run = async (label: string, f: () => Promise<unknown>) => {
    setError(null);
    setBusy(label);
    try {
      await f();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const importFiles = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length === 0) return;
    void run('Importing…', async () => {
      for (const [i, f] of files.entries()) {
        setBusy(`Importing ${i + 1}/${files.length}…`);
        // oxlint-disable-next-line no-await-in-loop -- one 11 MB tile decoded at a time
        await o.importViirs(f);
      }
    });
  };

  return (
    <>
      <h3>Night lights (VIIRS)</h3>
      <p className="muted hint">
        Sky brightness and Bortle come from NASA Black Marble VNP46A4 annual tiles. LAADS lists them openly but serves the files only to a signed-in{' '}
        <a href={EARTHDATA_SIGNUP} target="_blank" rel="noopener noreferrer">
          Earthdata account
        </a>{' '}
        (free). Download the tiles below from the{' '}
        <a href={laadsYearUrl(y)} target="_blank" rel="noopener noreferrer" data-viirs="laads">
          LAADS {y} folder
        </a>{' '}
        and import the .h5 files.
      </p>
      <div className="kv">
        <span className="k">Year</span>
        <b className="v">
          <input type="number" min={VIIRS_FIRST_YEAR} max={new Date().getUTCFullYear()} step={1} value={y} onChange={(e) => setYear(Number(e.target.value) || null)} aria-label="VIIRS composite year" />
          <button className="link" disabled={busy !== null} onClick={() => void run('Checking LAADS…', () => o.fetchViirsListing(y))} title="Fetch the year's tile list from LAADS">
            {listed ? 'Recheck LAADS' : 'Check LAADS'}
          </button>
        </b>
        <span className="k">Needed</span>
        <b className="v viirs-need" data-need={need.join(' ')}>
          {need.length === 0
            ? '—'
            : need.map((t) => (
                <span key={t} className={`chip viirs-${stateOf(t)}`} data-tile={t} title={stateOf(t) === TileState.Ocean ? 'Not published: no land lights' : stateOf(t) === TileState.Have ? 'Imported' : 'Not imported'}>
                  {t}
                </span>
              ))}
          <span className="muted"> · camera, target and saved regions + {VIIRS_MARGIN_KM} km</span>
        </b>
      </div>
      {years.length > 0 ? (
        <ul className="list" data-viirs="imported">
          {years.map((yr) => {
            const ts = viirs.tiles.filter((t) => t.year === yr);
            return (
              <li key={yr}>
                <span className="detail">
                  VNP46A4 {yr} · {ts.length} tile{ts.length === 1 ? '' : 's'} · {bytes(ts.reduce((n, t) => n + t.bytes, 0))}
                </span>
                <div className="actions">
                  <button className="link" onClick={() => window.confirm(`Remove the ${yr} VIIRS tiles?`) && void run('Removing…', () => o.removeViirs(yr))}>
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted hint" data-viirs="none">
          No VIIRS tiles imported
        </p>
      )}
      <label className="file">
        <input type="file" accept=".h5" multiple disabled={busy !== null} aria-label="Import VNP46A4 tiles" onChange={(e) => importFiles(e.currentTarget)} />
        {busy ?? 'Import VNP46A4 .h5 tiles'}
      </label>
      {error && <p className="error">{error}</p>}
    </>
  );
}

function GibsSection() {
  const gibs = useOffline((s) => s.gibs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = async () => {
    if (!window.confirm('Clear the cached VIIRS nightly tiles? The Night tab downloads them again when it next shows the sky.')) return;
    setError(null);
    setBusy(true);
    try {
      await clearGibs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Nightly lights (GIBS)</h3>
      <p className="muted hint">Where no year is imported, the Night tab reads the last nights of VIIRS from NASA GIBS and keeps them here; older nights are dropped on their own.</p>
      <div className="list" data-gibs={gibs.bytes}>
        <span className="detail">
          {gibs.nights} night{gibs.nights === 1 ? '' : 's'} · {gibs.tiles} tile{gibs.tiles === 1 ? '' : 's'} · {bytes(gibs.bytes)}
        </span>
        <div className="actions">
          <button className="link" disabled={busy || gibs.bytes === 0} onClick={() => void clear()}>
            {busy ? 'Clearing…' : 'Clear'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

function GeoidSection() {
  const geoid = useOffline((s) => s.geoid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = offlineStore.getState();

  const importGeoid = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      await o.importGeoid(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (window.confirm('Remove the imported geoid? PLATEAU heights fall back to a Tokyo average.')) void o.removeGeoid();
  };

  return (
    <>
      <h3>Geoid (Japan)</h3>
      <p className="muted hint">
        PLATEAU buildings carry ellipsoid heights; GSI’s geoid sets them on the terrain anywhere in Japan, where a central-Tokyo constant can be metres off. Download “日本のジオイド2011” from{' '}
        <a href={GEOID_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          GSI
        </a>{' '}
        and import the .zip or .asc.
      </p>
      {geoid ? (
        <div className="list" data-geoid="imported">
          <span className="detail">
            GSIGEO2011 {geoid.version} · {geoid.fileName} · {bytes(geoid.bytes)} · imported {geoid.importedAt.slice(0, 10)}
          </span>
          <div className="actions">
            <button className="link" onClick={remove}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <p className="muted hint" data-geoid="none">
          Not imported
        </p>
      )}
      <label className="file">
        <input type="file" accept=".asc,.zip,.gz" disabled={busy} aria-label="Import the GSI geoid" onChange={(e) => void importGeoid(e.currentTarget)} />
        {busy ? 'Importing…' : geoid ? 'Replace the geoid file' : 'Import the geoid file'}
      </label>
      {error && <p className="error">{error}</p>}
    </>
  );
}

function Job({ job }: { job: DownloadJob }) {
  const o = offlineStore.getState();
  const running = job.state === JobState.Running || job.state === JobState.Estimating;
  const pct = job.total > 0 ? Math.min(100, (job.done / job.total) * 100) : 0;
  return (
    <li className="job">
      <div className="head">
        <span>{job.name}</span>
        <span className="chip">{KIND_LABEL[job.kind]}</span>
      </div>
      <div className="progress">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="head">
        <span className="detail">
          {job.done.toLocaleString()} / {job.total.toLocaleString()} tiles · {bytes(job.bytes)} · {STATE_LABEL[job.state]}
        </span>
        <button className="link" onClick={() => (running ? o.cancel(job.id) : o.dismiss(job.id))}>
          {running ? 'Cancel' : 'Dismiss'}
        </button>
      </div>
      {job.error && <p className="error">{job.error}</p>}
    </li>
  );
}
