import { addProtocol } from 'maplibre-gl';
import { FileSource, PMTiles, Protocol } from 'pmtiles';
import type { ArchiveMeta } from '@workers/region.protocol';
import { archiveKey, OpfsSource } from './opfs';

let protocol: Protocol | null = null;

/** Registers the pmtiles:// protocol once; safe to call repeatedly. */
export function ensurePmtilesProtocol(): Protocol {
  if (!protocol) {
    protocol = new Protocol({ metadata: true });
    addProtocol('pmtiles', protocol.tile);
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
