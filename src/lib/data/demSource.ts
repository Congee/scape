import { addSourceType, RasterDEMTileSource, type Dispatcher, type Evented, type MessageType, type SourceClass, type Tile } from 'maplibre-gl';
import { encodeTerrariumPadded } from '@core/terrain/terrarium';
import { loadDemTile } from './demProtocol';

/** The spec MapLibre's own DEM source takes; ours differs only in the `type` that selects it. */
type DemSpec = ConstructorParameters<typeof RasterDEMTileSource>[1];

const EXACT_TYPE = 'scape-raster-dem';

/**
 * Elevations decoded by us rather than by MapLibre.
 *
 * MapLibre unpacks a `raster-dem` tile by drawing it into a 2D canvas and reading it back, and
 * anti-fingerprinting browsers perturb that readback: one unit of red is a 256 m spike. Its own
 * guard against those browsers probes 25 pixels, which sparse noise misses. So the tile is fetched
 * and decoded through WebCodecs here, and the worker is handed pixels it will not touch a canvas
 * to read: `RasterDEMTileWorkerSource` only rasterises what is an `ImageBitmap`.
 */
class ExactRasterDEMTileSource extends RasterDEMTileSource {
  constructor(id: string, options: DemSpec, dispatcher: Dispatcher, eventedParent: Evented) {
    // Everything downstream — hillshade's style validation, the tile manager's DEM backfill —
    // keys off the spec type, so only the registry name is ours.
    super(id, { ...options, type: 'raster-dem' }, dispatcher, eventedParent);
  }

  override async loadTile(tile: Tile): Promise<void> {
    const { z, x, y } = tile.tileID.canonical;
    // oxlint-disable-next-line no-underscore-dangle -- MapLibre's own name for it
    tile.neighboringTiles = this._getNeighboringTiles(tile.tileID);
    tile.abortController = new AbortController();
    try {
      const dem = await loadDemTile({ z, x, y }, tile.abortController.signal);
      delete (tile as Partial<Tile>).abortController;
      if (tile.aborted) {
        tile.state = 'unloaded';
        return;
      }
      // oxlint-disable-next-line no-underscore-dangle -- MapLibre's own name for it
      if (this.map._refreshExpiredTiles && (dem.cacheControl || dem.expires)) {
        tile.setExpiryData({ cacheControl: dem.cacheControl, expires: dem.expires });
      }
      // A plain padded RGBA image, so the worker uses it as-is instead of reading a canvas.
      const rawImageData = new ImageData(encodeTerrariumPadded(dem.elev, dem.size), dem.size + 4, dem.size + 4);
      if (tile.actor && tile.state !== 'expired' && tile.state !== 'reloading') return;
      await this.dispatcher.waitForInitComplete();
      if (!tile.actor || tile.state === 'expired') tile.actor = this.dispatcher.getReadyActor();
      tile.dem = await tile.actor.sendAsync({
        type: 'LDT' as MessageType.loadDEMTile,
        data: {
          type: this.type,
          uid: tile.uid,
          source: this.id,
          rawImageData,
          encoding: this.encoding,
          // Unpacking factors, `custom` encoding only; the fallbacks are DEMData's own defaults.
          redFactor: this.redFactor ?? 1,
          greenFactor: this.greenFactor ?? 1,
          blueFactor: this.blueFactor ?? 1,
          baseShift: this.baseShift ?? 0
        }
      });
      tile.needsHillshadePrepare = true;
      tile.needsTerrainPrepare = true;
      tile.needsColorReliefPrepare = true;
      tile.state = 'loaded';
    } catch (err) {
      delete (tile as Partial<Tile>).abortController;
      if (tile.aborted) tile.state = 'unloaded';
      else if (err) {
        tile.state = 'errored';
        throw err;
      }
    }
  }
}

/** WebCodecs is what makes the exact decode possible; without it MapLibre's own source is all there is. */
const exact = typeof ImageDecoder !== 'undefined';

let registering: Promise<void> | undefined;

/**
 * Registers the source type. Its effect lands before the promise does, so a caller that cannot
 * await it still gets a registered type. The one way it fails is the name already being taken —
 * an HMR reload, or a second instance of this module — and then it is registered, which is all
 * this asks for.
 */
export function ensureDemSourceType(): Promise<void> {
  registering ??= exact ? addSourceType(EXACT_TYPE, ExactRasterDEMTileSource as unknown as SourceClass).catch(() => {}) : Promise.resolve();
  return registering;
}

/** A DEM source spec pointed at whichever decode this browser can do. */
export function demSourceSpec(spec: Omit<DemSpec, 'type'>): DemSpec {
  return { ...spec, type: exact ? EXACT_TYPE : 'raster-dem' } as DemSpec;
}
