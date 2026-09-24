import { addProtocol } from 'maplibre-gl';
import { FileSource, PMTiles, Protocol } from 'pmtiles';
import type { ArchiveMeta } from '@workers/region.protocol';
import { ASSET_PROTOCOL, assetFileName, parseAssetUrl } from './openfreemap';
import { archiveKey, OpfsSource, readAsset } from './opfs';

let protocol: Protocol | null = null;

/** Registers the pmtiles:// and scape-asset:// protocols once; safe to call repeatedly. */
export function ensurePmtilesProtocol(): Protocol {
  if (!protocol) {
    protocol = new Protocol({ metadata: true });
    addProtocol('pmtiles', protocol.tile);
    addProtocol(ASSET_PROTOCOL, async (params) => {
      const at = parseAssetUrl(params.url);
      if (!at) throw new Error(`Bad asset URL ${params.url}`);
      const data = await readAsset(at.id, assetFileName(at.path));
      return { data: params.type === 'json' ? JSON.parse(new TextDecoder().decode(data)) : data };
    });
  }
  return protocol;
}

/** Makes a local .pmtiles file addressable as pmtiles://<name> for this session. */
export function registerLocalPmtiles(file: File): string {
  const p = new PMTiles(new FileSource(file));
  ensurePmtilesProtocol().add(p);
  return file.name;
}

/** Makes an offline archive addressable as pmtiles://opfs/<id>.pmtiles. */
export function registerArchive(meta: ArchiveMeta): void {
  ensurePmtilesProtocol().add(new PMTiles(new OpfsSource(meta.id)));
}

export function unregisterArchive(id: string): void {
  ensurePmtilesProtocol().tiles.delete(archiveKey(id));
}
