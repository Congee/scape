import { create } from 'zustand';
import { prepareConstellations, type ConstellationSet, type PreparedConstellations } from '@core/astro/constellations';
import { parseStarCatalog, type StarCatalog } from '@core/astro/stars';

/** Equirectangular J2000 sky image: RA 0h at the centre increasing leftward, north up. */
export interface SkyTexture {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface SkyState {
  stars: StarCatalog | null;
  constellations: PreparedConstellations | null;
  milkyWay: SkyTexture | null;
  /** Selenographic equirectangular map: longitude 0 at the centre, east to the right, north up. */
  moonMap: SkyTexture | null;
  loading: boolean;
  error: string | null;
  /** Starts loading the bundled sky data once; cheap to call every frame. */
  ensure(): void;
}

const base = import.meta.env.BASE_URL;
let started = false;

async function fetchOk(path: string): Promise<Response> {
  const res = await fetch(`${base}sky/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
}

async function loadTexture(path: string): Promise<SkyTexture> {
  const bmp = await createImageBitmap(await (await fetchOk(path)).blob());
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    return { width: bmp.width, height: bmp.height, rgba: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
  } finally {
    bmp.close();
  }
}

export const skyStore = create<SkyState>()((set, get) => ({
  stars: null,
  constellations: null,
  milkyWay: null,
  moonMap: null,
  loading: false,
  error: null,
  ensure: () => {
    if (started) return;
    started = true;
    set({ loading: true });
    const fail = (e: unknown) => set({ error: e instanceof Error ? e.message : String(e) });
    const stars = Promise.all([fetchOk('stars.bin').then((r) => r.arrayBuffer()), fetchOk('star-names.json').then((r) => r.json() as Promise<[number, string][]>)])
      .then(([buf, names]) => set({ stars: parseStarCatalog(buf, names) }))
      .catch(fail);
    const lines = fetchOk('constellations.json')
      .then((r) => r.json() as Promise<ConstellationSet>)
      .then(async (c) => {
        await stars;
        set({ constellations: prepareConstellations(c, get().stars) });
      })
      .catch(fail);
    const mw = loadTexture('milkyway.jpg')
      .then((milkyWay) => set({ milkyWay }))
      .catch(fail);
    const moon = loadTexture('moon.jpg')
      .then((moonMap) => set({ moonMap }))
      .catch(fail);
    void Promise.allSettled([stars, lines, mw, moon]).then(() => set({ loading: false }));
  }
}));

export const useSky = skyStore;
