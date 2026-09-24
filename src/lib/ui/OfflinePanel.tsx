import { useEffect, useState } from 'react';
import { bboxCentre, type Bbox } from '@core/geo/bbox';
import { formatLngLat } from '@core/geo/coords';
import { distanceM } from '@core/geo/geodesy';
import { bytes } from '@core/format';
import { BUILDINGS_DEFAULT_MAX_TILES, BUILDINGS_ZOOM, buildingsByDefault } from '@core/tiles/buildingsRegion';
import { PmFlavor } from '@data/basemaps';
import { OVERTURE_BUILDINGS_RELEASE, OVERTURE_BUILDINGS_URL } from '@data/buildingTiles';
import { BASEMAP_DEFAULT_MAX_TILES, basemapByDefault, isPmtilesUrl, OFM_STYLE, OFM_TILEJSON } from '@data/openfreemap';
import { PROTOMAPS_BUILD } from '@data/protomaps';
import { demZoom, TERRAIN_TILE_URL } from '@data/terrainTiles';
import { defaultBasemapSourceUrl, GEOID_DOWNLOAD_URL, JobState, offlineStore, useOffline, warmStyleAssets, type DownloadJob } from '@state/offline';
import { settingsStore, useSettings } from '@state/settings';
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

const KIND_LABEL: Record<ArchiveKind, string> = { [ArchiveKind.Basemap]: 'Basemap', [ArchiveKind.Terrain]: 'Terrain', [ArchiveKind.Buildings]: 'Buildings' };

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
  a.kind === ArchiveKind.Terrain ? TERRAIN_TILE_URL : a.kind === ArchiveKind.Buildings ? OVERTURE_BUILDINGS_URL : a.sourceUrl.startsWith(PROTOMAPS_BUILD) ? defaultBasemapSourceUrl() : a.sourceUrl;

const ZOOMS: Record<ArchiveKind, [number, number] | null> = {
  [ArchiveKind.Basemap]: null,
  [ArchiveKind.Terrain]: [TERRAIN_MIN_ZOOM, TERRAIN_MAX_ZOOM],
  [ArchiveKind.Buildings]: [BUILDINGS_ZOOM, BUILDINGS_ZOOM]
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
  const [sourceUrl, setSourceUrl] = useState(OFM_TILEJSON);
  const [estimates, setEstimates] = useState<Partial<Record<ArchiveKind, Estimate>>>({});
  const [error, setError] = useState<string | null>(null);
  /** Null follows the region's size. */
  const [withBuildings, setWithBuildings] = useState<boolean | null>(null);
  const [withBasemap, setWithBasemap] = useState<boolean | null>(null);

  useEffect(() => {
    const s = offlineStore.getState();
    if (!s.loaded) void s.load();
    void s.refreshStorage();
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
    const [minZoom, maxZ] = ZOOMS[kind] ?? [0, maxZoom];
    const url = sourceUrl.trim() || OFM_TILEJSON;
    return {
      kind,
      name: name.trim() || todayName(),
      bbox,
      minZoom,
      maxZoom: maxZ,
      sourceUrl: kind === ArchiveKind.Terrain ? TERRAIN_TILE_URL : kind === ArchiveKind.Buildings ? OVERTURE_BUILDINGS_URL : url,
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
        <button className={drawing ? 'on' : ''} onClick={() => o.setDrawing(!drawing)}>
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

      <GeoidSection />
    </div>
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
