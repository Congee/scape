/** OpenFreeMap per-tile vector source packed into local archives. Pure: URL and style rewriting only. */

import type { StyleSpecification } from 'maplibre-gl';

/** TileJSON of the current planet build; its tile URL carries a build stamp that changes. */
export const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> contributors';
/** OpenFreeMap is a free service; stay well below browser connection limits. */
export const OFM_CONCURRENCY = 6;

/**
 * Glyph ranges cached per font: Latin, Latin Extended A/B, IPA and diacritics, Greek, Cyrillic and
 * general punctuation. Other scripts fall back to MapLibre's local rendering.
 */
export const GLYPH_RANGES = ['0-255', '256-511', '512-767', '768-1023', '1024-1279', '8192-8447'] as const;
/** The map's own overlay labels ask for this font whatever the style uses. */
const OVERLAY_FONT = 'Noto Sans Regular';

export const ASSET_PROTOCOL = 'scape-asset';

/** A local file cached next to archive `id`, as MapLibre requests it. */
export const assetUrl = (id: string, path: string): string => `${ASSET_PROTOCOL}://${id}/${path}`;

/** Archive id and file path from an asset URL; the path comes back decoded. */
export function parseAssetUrl(url: string): { id: string; path: string } | null {
  const m = new RegExp(`^${ASSET_PROTOCOL}://([^/]+)/(.+)$`).exec(url);
  if (!m) return null;
  try {
    return { id: m[1], path: decodeURIComponent(m[2].split(/[?#]/)[0]) };
  } catch {
    return null;
  }
}

/** Flat OPFS file name for an asset path. */
export const assetFileName = (path: string): string => encodeURIComponent(path);

export const isPmtilesUrl = (url: string): boolean => /\.pmtiles(?:[?#]|$)/i.test(url.trim());

export interface TileJsonSource {
  /** `{z}/{x}/{y}` tile URL template. */
  template: string;
  minZoom: number;
  maxZoom: number;
  attribution: string;
  vectorLayers: unknown[];
  /** Build day, "2026-09-13", when the template carries one. */
  build: string | null;
}

/** The first tile template of a TileJSON document, resolved against where it was fetched. */
export function parseTileJson(json: unknown, base: string): TileJsonSource {
  const j = (json ?? {}) as { tiles?: unknown; minzoom?: unknown; maxzoom?: unknown; attribution?: unknown; vector_layers?: unknown };
  const first = Array.isArray(j.tiles) ? j.tiles.find((t): t is string => typeof t === 'string') : undefined;
  if (!first) throw new Error('The TileJSON lists no tile URL');
  // URL() escapes the braces, which must stay literal.
  const template = new URL(first, base).href.replaceAll('%7B', '{').replaceAll('%7D', '}');
  return {
    template,
    minZoom: typeof j.minzoom === 'number' ? j.minzoom : 0,
    maxZoom: typeof j.maxzoom === 'number' ? j.maxzoom : 14,
    attribution: typeof j.attribution === 'string' && j.attribution ? j.attribution : OFM_ATTRIBUTION,
    vectorLayers: Array.isArray(j.vector_layers) ? j.vector_layers : [],
    build: buildOfTemplate(template)
  };
}

/** "…/planet/20260913_164504_pt/{z}/…" → "2026-09-13". */
export function buildOfTemplate(template: string): string | null {
  const m = /\/(\d{4})(\d{2})(\d{2})_\d+/.exec(template);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** Zoom levels fetched: the basemap policy (0 to the chosen maximum) within what the source has. */
export function packZooms(minZoom: number, maxZoom: number, src: Pick<TileJsonSource, 'minZoom' | 'maxZoom'>): [number, number] {
  const lo = Math.max(minZoom, src.minZoom);
  return [lo, Math.max(lo, Math.min(maxZoom, src.maxZoom))];
}

// Expression operators are lower-case words; font names are not.
const isFontStack = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string') && !/^[a-z-]+$/.test(v[0] as string);

function collectStacks(v: unknown, out: Set<string>): void {
  if (isFontStack(v)) {
    out.add(v.join(','));
    return;
  }
  if (Array.isArray(v)) for (const e of v) collectStacks(e, out);
}

/** Font stacks the style's symbol layers ask for, as MapLibre names them in glyph URLs. */
export function styleFontstacks(style: Pick<StyleSpecification, 'layers'>): string[] {
  const out = new Set<string>();
  for (const l of style.layers) {
    if (l.type !== 'symbol') continue;
    collectStacks((l.layout as { 'text-font'?: unknown } | undefined)?.['text-font'], out);
  }
  out.add(OVERLAY_FONT);
  return [...out].toSorted();
}

export function glyphUrls(glyphs: string, fontstacks: readonly string[], ranges: readonly string[] = GLYPH_RANGES): Array<{ url: string; path: string }> {
  return fontstacks.flatMap((stack) =>
    ranges.map((range) => ({
      url: glyphs.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', range),
      path: `fonts/${stack}/${range}.pbf`
    }))
  );
}

const SPRITE_FILES = ['.json', '.png', '@2x.json', '@2x.png'];

/** Sprite sheets at both pixel ratios; a style with several sprites keeps each under its id. */
export function spriteUrls(sprite: StyleSpecification['sprite']): Array<{ url: string; path: string }> {
  if (!sprite) return [];
  const list = typeof sprite === 'string' ? [{ id: '', url: sprite }] : sprite;
  return list.flatMap(({ id, url }) => SPRITE_FILES.map((ext) => ({ url: `${url}${ext}`, path: `sprite${id ? `-${id}` : ''}${ext}` })));
}

/**
 * The style served from archive `id`: vector sources read the archive, sprites and glyphs the
 * cache, and sources the archive cannot answer (Liberty's Natural Earth relief) are dropped.
 */
export function localStyle(style: StyleSpecification, id: string, attribution: string): StyleSpecification {
  const sources: StyleSpecification['sources'] = {};
  for (const [name, src] of Object.entries(style.sources)) {
    if (src.type !== 'vector') continue;
    sources[name] = { type: 'vector', url: `pmtiles://opfs/${id}.pmtiles`, attribution };
  }
  const sprite = style.sprite;
  return {
    ...style,
    sources,
    layers: style.layers.filter((l) => !('source' in l) || (typeof l.source === 'string' && l.source in sources)),
    ...(sprite && {
      sprite: typeof sprite === 'string' ? assetUrl(id, 'sprite') : sprite.map((s) => ({ id: s.id, url: assetUrl(id, `sprite-${s.id}`) }))
    }),
    glyphs: assetUrl(id, 'fonts/{fontstack}/{range}.pbf')
  };
}
