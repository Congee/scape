import { parseBesselian, type BesselianElements, type BesselianFile } from '@core/astro/besselian';

let pending: Promise<BesselianElements[]> | null = null;

/** NASA's solar eclipse elements for 2000–2100, fetched once and kept; a failed fetch rejects and is retried on the next call. */
export function besselianElements(): Promise<BesselianElements[]> {
  pending ??= fetch(`${import.meta.env.BASE_URL}eclipses/besselian.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`eclipse elements ${res.status}`);
      return res.json() as Promise<BesselianFile>;
    })
    .then(parseBesselian)
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
}
