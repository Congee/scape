/// <reference lib="webworker" />
import { Compression, FetchSource, FileSource, PMTiles, tileIdToZxy, TileType, type Header } from 'pmtiles';
import { bboxCentre } from '@core/geo/bbox';
import { planExtract } from '@core/tiles/extract';
import type { StyleSpecification } from 'maplibre-gl';
import { ArchiveBuilder, coalesceRanges, gzip, tileCountInBounds, tileIdsInBounds, tileRange, type TileSink } from '@core/tiles/pmtiles';
import {
  assetFileName,
  glyphUrls,
  isPmtilesUrl,
  localStyle,
  OFM_CONCURRENCY,
  OFM_STYLE,
  packZooms,
  parseTileJson,
  spriteUrls,
  styleFontstacks,
  tileUrl,
  type TileJsonSource
} from '@data/openfreemap';
import { announceArchives, archiveName, archivesDir, assetsDirName, metaFromHeader, readHeader, vectorLayerIds, writeFileBytes, writeMeta } from '@data/opfs';
import { buildDateCandidates, buildUrl } from '@data/protomaps';
import { demZoom, TERRAIN_ATTRIBUTION, terrainTileUrl, TERRAIN_TILE_BYTES, TERRAIN_TILE_MIME } from '@data/terrainTiles';
import { ArchiveKind, RegionRequestKind, RegionResponseKind, type ArchiveMeta, type Estimate, type RegionRequest, type RegionResponse, type RegionSpec } from './region.protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Fixed for terrain: the app's own decoder reads these tiles online and offline alike. */
const TERRAIN_MIN_ZOOM = demZoom(6);
const TERRAIN_MAX_ZOOM = demZoom(14);
const MAX_GAP = 65_536;
const MAX_CHUNK = 4 * 1024 * 1024;
const COPY_CHUNK = 8 * 1024 * 1024;
const PROGRESS_MS = 150;
const BASEMAP_CONCURRENCY = 4;
const TERRAIN_CONCURRENCY = 8;
const RETRIES = 3;
/** Gzipped vector tile size assumed when a server hides Content-Length. */
const FALLBACK_TILE_BYTES = 60_000;

const jobs = new Map<string, AbortController>();

const post = (res: RegionResponse) => scope.postMessage(res);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const reporter = (id: string, total: number) => {
  let last = 0;
  return (done: number, bytes: number) => {
    const now = Date.now();
    if (now - last < PROGRESS_MS) return;
    last = now;
    post({ kind: RegionResponseKind.Progress, id, done, total, bytes });
  };
};

// --- fetching -----------------------------------------------------------

async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- retries are sequential by nature
      const res = await fetch(url, init);
      if (res.ok || res.status === 404 || res.status === 403) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
    }
    if (init.signal?.aborted) break;
    // oxlint-disable-next-line no-await-in-loop
    await delay(200 * 2 ** attempt);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function fetchRange(url: string, offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetchRetry(url, { signal, headers: { range: `bytes=${offset}-${offset + length - 1}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for bytes ${offset}-${offset + length - 1}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Runs `fn` with a lookahead window but yields results in input order. */
async function* inOrder<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): AsyncGenerator<R> {
  // Settled wrappers keep a later rejection from going unhandled while an earlier one is awaited.
  const start = (item: T) => fn(item).then((value) => ({ value }), (error: unknown) => ({ error }));
  const queue: Array<ReturnType<typeof start>> = [];
  let next = 0;
  while (next < items.length && queue.length < concurrency) queue.push(start(items[next++]));
  while (queue.length) {
    // oxlint-disable-next-line no-await-in-loop -- the window is already running ahead
    const settled = await queue.shift()!;
    if (next < items.length) queue.push(start(items[next++]));
    if ('error' in settled) throw settled.error instanceof Error ? settled.error : new Error(String(settled.error));
    yield settled.value;
  }
}

/** The daily Protomaps build is published late, so fall back to earlier UTC days. */
async function openRemote(sourceUrl: string, signal: AbortSignal): Promise<{ pm: PMTiles; url: string; header: Header }> {
  const dated = /build\.protomaps\.com\/(\d{4})(\d{2})(\d{2})\.pmtiles/.exec(sourceUrl);
  const urls = dated
    ? buildDateCandidates(new Date(Date.UTC(+dated[1], +dated[2] - 1, +dated[3]))).map(buildUrl)
    : [sourceUrl];
  let last: unknown;
  for (const url of urls) {
    try {
      const pm = new PMTiles(new FetchSource(url));
      // oxlint-disable-next-line no-await-in-loop -- candidate dates are tried oldest-last
      const header = await pm.getHeader();
      return { pm, url, header };
    } catch (e) {
      last = e;
      if (signal.aborted) break;
    }
  }
  const msg = last instanceof Error ? last.message : String(last);
  throw new Error(`Could not read ${sourceUrl}: ${msg}${msg === 'Failed to fetch' ? ' (offline, or the server does not allow cross-origin range requests from this origin)' : ''}`);
}

// --- OPFS output --------------------------------------------------------

class SyncSink implements TileSink {
  private at = 0;

  constructor(private readonly handle: FileSystemSyncAccessHandle) {}

  write(bytes: Uint8Array): void {
    this.handle.write(bytes, { at: this.at });
    this.at += bytes.length;
  }
}

async function openSync(dir: FileSystemDirectoryHandle, name: string): Promise<FileSystemSyncAccessHandle> {
  const handle = await dir.getFileHandle(name, { create: true });
  if (typeof handle.createSyncAccessHandle !== 'function') throw new Error('This browser cannot write offline archives');
  const sync = await handle.createSyncAccessHandle();
  sync.truncate(0);
  return sync;
}

const removeQuietly = async (dir: FileSystemDirectoryHandle, name: string) => {
  try {
    await dir.removeEntry(name);
  } catch {
    // already gone
  }
};

const dropPartial = async (id: string) => {
  try {
    const dir = await archivesDir();
    await removeQuietly(dir, archiveName(id));
    await dir.removeEntry(assetsDirName(id), { recursive: true }).catch(() => undefined);
  } catch {
    // no directory, nothing to clean
  }
};

/** `<id>.pmtiles` = archive prefix + the tile data written to the temp file. */
async function assemble(dir: FileSystemDirectoryHandle, id: string, prefix: Uint8Array, data: FileSystemSyncAccessHandle): Promise<number> {
  const out = await openSync(dir, archiveName(id));
  try {
    out.write(prefix, { at: 0 });
    const size = data.getSize();
    const buf = new Uint8Array(Math.min(COPY_CHUNK, Math.max(size, 1)));
    let at = 0;
    while (at < size) {
      const n = data.read(buf, { at });
      if (n <= 0) break;
      out.write(buf.subarray(0, n), { at: prefix.length + at });
      at += n;
    }
    out.flush();
    return prefix.length + size;
  } finally {
    out.close();
  }
}

// --- downloads ----------------------------------------------------------

/** Basemap and buildings: a sub-extract of a remote PMTiles archive, tile bytes copied as stored. */
async function downloadExtract(id: string, spec: RegionSpec, signal: AbortSignal): Promise<ArchiveMeta> {
  const { pm, url, header } = await openRemote(spec.sourceUrl, signal);
  const reader = { header, getDirectory: (offset: number, length: number) => pm.cache.getDirectory(pm.source, offset, length, header) };
  const plan = await planExtract(reader, spec.bbox, spec.minZoom, spec.maxZoom);
  if (!plan.tileCount) throw new Error('The source has no tiles in that area');
  const metadata = await pm.getMetadata().catch(() => ({}));

  const byRange = new Map<string, number[]>();
  for (const t of plan.tiles) {
    const key = `${t.offset}:${t.length}`;
    const ids = byRange.get(key);
    if (ids) ids.push(t.tileId);
    else byRange.set(key, [t.tileId]);
  }
  const chunks = coalesceRanges(plan.ranges, MAX_GAP, MAX_CHUNK);

  const dir = await archivesDir();
  const tmpName = `${id}.data`;
  const tmp = await openSync(dir, tmpName);
  try {
    const builder = new ArchiveBuilder(new SyncSink(tmp));
    const report = reporter(id, plan.tileCount);
    let done = 0;
    // Offset order keeps the new archive clustered, so it reads back in near-sequential ranges.
    for await (const { chunk, bytes } of inOrder(chunks, BASEMAP_CONCURRENCY, async (c) => ({
      chunk: c,
      bytes: await fetchRange(url, c.offset, c.length, signal)
    }))) {
      signal.throwIfAborted();
      for (const r of chunk.ranges) {
        const start = r.offset - chunk.offset;
        const slice = bytes.subarray(start, start + r.length);
        const key = `${r.offset - header.tileDataOffset}:${r.length}`;
        for (const tileId of byRange.get(key) ?? []) {
          // oxlint-disable-next-line no-await-in-loop -- one sequential writer
          await builder.add(tileId, slice, key);
          done++;
        }
      }
      report(done, builder.dataLength);
    }

    const prefix = await builder.finish({
      tileType: header.tileType,
      tileCompression: header.tileCompression,
      minZoom: plan.minZoom,
      maxZoom: plan.maxZoom,
      bounds: spec.bbox,
      centre: { ...bboxCentre(spec.bbox), zoom: Math.round((plan.minZoom + plan.maxZoom) / 2) },
      metadata
    });
    signal.throwIfAborted();
    const bytes = await assemble(dir, id, prefix, tmp);
    return {
      id,
      name: spec.name,
      kind: spec.kind,
      bbox: spec.bbox,
      minZoom: plan.minZoom,
      maxZoom: plan.maxZoom,
      bytes,
      tileCount: plan.tileCount,
      sourceUrl: url,
      downloadedAt: new Date().toISOString()
    };
  } finally {
    tmp.close();
    await removeQuietly(dir, tmpName);
  }
}

async function downloadTerrain(id: string, spec: RegionSpec, signal: AbortSignal): Promise<ArchiveMeta> {
  const ids = tileIdsInBounds(spec.bbox, TERRAIN_MIN_ZOOM, TERRAIN_MAX_ZOOM);
  const dir = await archivesDir();
  const tmpName = `${id}.data`;
  const tmp = await openSync(dir, tmpName);
  try {
    const builder = new ArchiveBuilder(new SyncSink(tmp));
    const report = reporter(id, ids.length);
    let done = 0;
    for await (const got of inOrder(ids, TERRAIN_CONCURRENCY, async (tileId) => {
      const [z, x, y] = tileIdToZxy(tileId);
      const res = await fetchRetry(terrainTileUrl(z, x, y), { signal });
      // Ocean and out-of-coverage tiles are simply absent.
      if (!res.ok) return { tileId, bytes: null };
      return { tileId, bytes: new Uint8Array(await res.arrayBuffer()) };
    })) {
      signal.throwIfAborted();
      done++;
      // oxlint-disable-next-line no-await-in-loop -- one sequential writer
      if (got.bytes) await builder.add(got.tileId, got.bytes);
      report(done, builder.dataLength);
    }
    if (!builder.count) throw new Error('No terrain tiles were available for that area');

    const prefix = await builder.finish({
      tileType: TERRAIN_TILE_MIME === 'image/webp' ? TileType.Webp : TileType.Png,
      tileCompression: Compression.None,
      minZoom: TERRAIN_MIN_ZOOM,
      maxZoom: TERRAIN_MAX_ZOOM,
      bounds: spec.bbox,
      centre: { ...bboxCentre(spec.bbox), zoom: TERRAIN_MIN_ZOOM },
      metadata: { name: spec.name, attribution: TERRAIN_ATTRIBUTION }
    });
    signal.throwIfAborted();
    const bytes = await assemble(dir, id, prefix, tmp);
    return {
      id,
      name: spec.name,
      kind: ArchiveKind.Terrain,
      bbox: spec.bbox,
      minZoom: TERRAIN_MIN_ZOOM,
      maxZoom: TERRAIN_MAX_ZOOM,
      bytes,
      tileCount: builder.count,
      sourceUrl: spec.sourceUrl,
      downloadedAt: new Date().toISOString()
    };
  } finally {
    tmp.close();
    await removeQuietly(dir, tmpName);
  }
}

async function fetchTileJson(url: string, signal: AbortSignal): Promise<TileJsonSource> {
  const res = await fetchRetry(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return parseTileJson(await res.json(), res.url || url);
}

const isGzip = (b: Uint8Array) => b.length > 1 && b[0] === 0x1f && b[1] === 0x8b;

/** The style, its sprites and the glyph ranges its fonts need, stored beside the archive. */
async function cacheStyle(id: string, styleUrl: string, attribution: string, signal: AbortSignal): Promise<void> {
  const res = await fetchRetry(styleUrl, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${styleUrl}`);
  const style = (await res.json()) as StyleSpecification;
  const assets = [...spriteUrls(style.sprite), ...(style.glyphs ? glyphUrls(style.glyphs, styleFontstacks(style)) : [])];
  const dir = await (await archivesDir()).getDirectoryHandle(assetsDirName(id), { create: true });
  for await (const got of inOrder(assets, OFM_CONCURRENCY, async (a) => {
    const r = await fetchRetry(a.url, { signal });
    // A missing glyph range is drawn locally by MapLibre; a missing sprite only hides icons.
    return { ...a, bytes: r.ok ? new Uint8Array(await r.arrayBuffer()) : null };
  })) {
    signal.throwIfAborted();
    // oxlint-disable-next-line no-await-in-loop -- one sequential writer
    if (got.bytes) await writeFileBytes(dir, assetFileName(got.path), got.bytes);
  }
  await writeFileBytes(dir, assetFileName('style.json'), new TextEncoder().encode(JSON.stringify(localStyle(style, id, attribution))));
}

/** A basemap from a TileJSON source (OpenFreeMap): per-tile vector PBFs packed like terrain. */
async function downloadTiles(id: string, spec: RegionSpec, signal: AbortSignal): Promise<ArchiveMeta> {
  const tj = await fetchTileJson(spec.sourceUrl, signal);
  const [minZoom, maxZoom] = packZooms(spec.minZoom, spec.maxZoom, tj);
  const ids = tileIdsInBounds(spec.bbox, minZoom, maxZoom);
  const dir = await archivesDir();
  const tmpName = `${id}.data`;
  const tmp = await openSync(dir, tmpName);
  try {
    const builder = new ArchiveBuilder(new SyncSink(tmp));
    const report = reporter(id, ids.length);
    let done = 0;
    for await (const got of inOrder(ids, OFM_CONCURRENCY, async (tileId) => {
      const [z, x, y] = tileIdToZxy(tileId);
      const res = await fetchRetry(tileUrl(tj.template, z, x, y), { signal });
      if (!res.ok) return { tileId, bytes: null };
      const raw = new Uint8Array(await res.arrayBuffer());
      // fetch undoes the server's Content-Encoding; store gzipped as PMTiles readers expect.
      return { tileId, bytes: isGzip(raw) ? raw : await gzip(raw) };
    })) {
      signal.throwIfAborted();
      done++;
      // oxlint-disable-next-line no-await-in-loop -- one sequential writer
      if (got.bytes) await builder.add(got.tileId, got.bytes);
      report(done, builder.dataLength);
    }
    if (!builder.count) throw new Error('The source has no tiles in that area');

    const prefix = await builder.finish({
      tileType: TileType.Mvt,
      tileCompression: Compression.Gzip,
      minZoom,
      maxZoom,
      bounds: spec.bbox,
      centre: { ...bboxCentre(spec.bbox), zoom: maxZoom },
      metadata: { name: spec.name, attribution: tj.attribution, vector_layers: tj.vectorLayers }
    });
    const styleUrl = spec.styleUrl ?? OFM_STYLE;
    await cacheStyle(id, styleUrl, tj.attribution, signal);
    signal.throwIfAborted();
    const bytes = await assemble(dir, id, prefix, tmp);
    return {
      id,
      name: spec.name,
      kind: ArchiveKind.Basemap,
      bbox: spec.bbox,
      minZoom,
      maxZoom,
      bytes,
      tileCount: builder.count,
      // The TileJSON, not the dated template, so an update picks up the newest build.
      sourceUrl: spec.sourceUrl,
      downloadedAt: new Date().toISOString(),
      style: styleUrl
    };
  } finally {
    tmp.close();
    await removeQuietly(dir, tmpName);
  }
}

/** Per-zoom tile size sampled with a HEAD of the centre tile. */
async function estimateTiles(spec: RegionSpec, signal: AbortSignal): Promise<Estimate> {
  const tj = await fetchTileJson(spec.sourceUrl, signal);
  const [minZoom, maxZoom] = packZooms(spec.minZoom, spec.maxZoom, tj);
  const zooms = Array.from({ length: maxZoom - minZoom + 1 }, (_, i) => minZoom + i);
  let tileCount = 0;
  let bytes = 0;
  for await (const got of inOrder(zooms, OFM_CONCURRENCY, async (z) => {
    const r = tileRange(spec.bbox, z)[0];
    const tiles = tileCountInBounds(spec.bbox, z, z);
    const res = await fetchRetry(tileUrl(tj.template, z, (r.x0 + r.x1) >> 1, (r.y0 + r.y1) >> 1), { signal, method: 'HEAD' });
    const length = Number(res.headers.get('content-length'));
    return { tiles, size: res.ok && length > 0 ? length : FALLBACK_TILE_BYTES };
  })) {
    tileCount += got.tiles;
    bytes += got.tiles * got.size;
  }
  return { tileCount, bytes, exact: false, sourceUrl: spec.sourceUrl, ...(tj.build && { build: tj.build }) };
}

async function importFile(id: string, file: File, name: string, signal: AbortSignal): Promise<ArchiveMeta> {
  const header = await readHeader(file);
  const dir = await archivesDir();
  const out = await openSync(dir, archiveName(id));
  try {
    const report = reporter(id, file.size);
    for (let at = 0; at < file.size; at += COPY_CHUNK) {
      signal.throwIfAborted();
      // oxlint-disable-next-line no-await-in-loop -- one sequential writer
      const chunk = new Uint8Array(await file.slice(at, at + COPY_CHUNK).arrayBuffer());
      out.write(chunk, { at });
      report(at + chunk.length, at + chunk.length);
    }
    out.flush();
  } catch (e) {
    await removeQuietly(dir, archiveName(id));
    throw e;
  } finally {
    out.close();
  }
  const layers = header.tileType === TileType.Mvt ? await vectorLayerIds(new FileSource(file)) : [];
  return metaFromHeader(id, name, header, file.size, `import:${file.name}`, layers);
}

async function estimate(spec: RegionSpec, signal: AbortSignal): Promise<Estimate> {
  if (spec.kind === ArchiveKind.Basemap && !isPmtilesUrl(spec.sourceUrl)) return estimateTiles(spec, signal);
  if (spec.kind === ArchiveKind.Terrain) {
    const tileCount = tileCountInBounds(spec.bbox, TERRAIN_MIN_ZOOM, TERRAIN_MAX_ZOOM);
    return { tileCount, bytes: tileCount * TERRAIN_TILE_BYTES, exact: false, sourceUrl: spec.sourceUrl };
  }
  const { pm, url, header } = await openRemote(spec.sourceUrl, signal);
  const reader = { header, getDirectory: (offset: number, length: number) => pm.cache.getDirectory(pm.source, offset, length, header) };
  const plan = await planExtract(reader, spec.bbox, spec.minZoom, spec.maxZoom);
  return { tileCount: plan.tileCount, bytes: plan.totalBytes, exact: true, sourceUrl: url };
}

// --- dispatch -----------------------------------------------------------

async function run(req: Exclude<RegionRequest, { kind: typeof RegionRequestKind.Cancel }>): Promise<void> {
  const controller = new AbortController();
  jobs.set(req.id, controller);
  const { signal } = controller;
  try {
    if (req.kind === RegionRequestKind.Estimate) {
      post({ kind: RegionResponseKind.Estimate, id: req.id, estimate: await estimate(req.spec, signal) });
      return;
    }
    const meta =
      req.kind === RegionRequestKind.Import
        ? await importFile(req.id, req.file, req.name, signal)
        : req.spec.kind === ArchiveKind.Terrain
          ? await downloadTerrain(req.id, req.spec, signal)
          : req.spec.kind === ArchiveKind.Basemap && !isPmtilesUrl(req.spec.sourceUrl)
            ? await downloadTiles(req.id, req.spec, signal)
            : await downloadExtract(req.id, req.spec, signal);
    await writeMeta(meta);
    announceArchives();
    post({ kind: RegionResponseKind.Done, id: req.id, meta });
  } catch (e) {
    // A cancel during assembly can leave a partial archive that listArchives would adopt.
    if (req.kind === RegionRequestKind.Download) await dropPartial(req.id);
    if (signal.aborted) return;
    post({ kind: RegionResponseKind.Error, id: req.id, message: e instanceof Error ? e.message : String(e) });
  } finally {
    jobs.delete(req.id);
  }
}

scope.addEventListener('message', (e: MessageEvent<RegionRequest>) => {
  const req = e.data;
  if (req.kind === RegionRequestKind.Cancel) {
    jobs.get(req.id)?.abort();
    return;
  }
  void run(req);
});
