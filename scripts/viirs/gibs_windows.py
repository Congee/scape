"""Builds calibrate.ts --windows input from GIBS VNP46A2 daily tiles: per-pixel median of nights, resampled to the 15" grid.

uv run --with numpy --with pillow scripts/viirs/gibs_windows.py --out <dir> --cache <dir> [--nights 8] [--far-zoom 6 --near-km 32] [--basket]
Writes <site>.u16 + <site>.json per SQM site and cost.json (tiles and bytes per night per site).
"""

import argparse
import io
import json
import math
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import numpy as np
from PIL import Image

LAYER = "VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance"
URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" + LAYER + "/default/{d}/GoogleMapsCompatible_Level8/{z}/{r}/{c}.png"
PALETTE = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/VIIRS_DayNightBand_At_Sensor_Radiance.xml"
REACH_KM = 384
PX_PER_DEG = 240
KM_LAT = 110.574
KM_LON = 111.32
NODATA = 0
# Output quantum, nW/(cm²·sr) per count; finer than VIIRS_SCALE so the 0.1-wide bottom bins keep their midpoints.
SCALE = 0.01
POLITE = 4

here = os.path.dirname(os.path.abspath(__file__))


def palette(cache: str) -> tuple[np.ndarray, int]:
    """gibs.ts's palette index → radiance table and saturated index, checked against the colormap's display bins."""
    src = "import { GIBS_RADIANCE, GIBS_SATURATED } from './src/lib/core/sky/gibs'; console.log(JSON.stringify([Array.from(GIBS_RADIANCE), GIBS_SATURATED]));"
    lut, sat = json.loads(subprocess.run(["bun", "-e", src], cwd=os.path.join(here, "../.."), check=True, capture_output=True, text=True).stdout)
    lut = np.array(lut, np.float64)
    p = os.path.join(cache, "palette.xml")
    if not os.path.exists(p):
        urllib.request.urlretrieve(PALETTE, p)
    # `value`, not `sourceValue`: the latter has the ref 91 typo [9.8,100).
    bins = {int(r): (float(lo), float(hi)) for lo, hi, r in re.findall(r' value="\[([\d.]+),([\d.]+)\)" ref="(\d+)"', open(p).read())}
    want = {i: lo if i == sat else (lo + hi) / 2 for i, (lo, hi) in bins.items()}
    bad = [i for i in range(1, 256) if not math.isclose(lut[i], want.get(i, 0), abs_tol=1e-9)]
    if len(bins) != sat or bad:
        raise RuntimeError(f"colormap disagrees with gibs.ts at refs {bad}")
    return lut, sat


def sites(basket: bool) -> list[dict]:
    mod, name = ("./scripts/viirs/basket", "BASKET") if basket else ("./src/lib/core/sky/skyglow.sites", "SQM_SITES")
    src = f"import {{ {name} }} from '{mod}'; console.log(JSON.stringify({name}));"
    return json.loads(subprocess.run(["bun", "-e", src], cwd=os.path.join(here, "../.."), check=True, capture_output=True, text=True).stdout)


def key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def window(lat: float, lng: float, km: float) -> tuple[int, int, int, int]:
    """viirs.ts windowAround without the texture cap."""
    d_lat = km / KM_LAT
    far = min(85, abs(lat) + d_lat)
    d_lon = min(180, km / (KM_LON * math.cos(math.radians(far))))
    row0 = max(0, math.floor((90 - min(90, lat + d_lat)) * PX_PER_DEG))
    row1 = min(180 * PX_PER_DEG, math.ceil((90 - max(-90, lat - d_lat)) * PX_PER_DEG))
    col0 = math.floor((lng - d_lon + 180) * PX_PER_DEG)
    col1 = math.ceil((lng + d_lon + 180) * PX_PER_DEG)
    return row0, col0, row1 - row0, col1 - col0


def merc(lat: np.ndarray, lng: np.ndarray, z: int) -> tuple[np.ndarray, np.ndarray]:
    n = 256 * 2**z
    x = np.floor((((lng + 180) / 360) % 1) * n).astype(np.int64)
    phi = np.radians(np.clip(lat, -85.05, 85.05))
    y = np.floor((1 - np.log(np.tan(phi) + 1 / np.cos(phi)) / math.pi) / 2 * n).astype(np.int64)
    return y, x


def fetch(cache: str, d: str, z: int, r: int, c: int) -> bytes | None:
    p = os.path.join(cache, d, str(z), str(r), f"{c}.png")
    if os.path.exists(p):
        return open(p, "rb").read() or None
    body = b""
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL.format(d=d, z=z, r=r, c=c), headers={"User-Agent": "scape-calibration/1 (research, low rate)"})
            with urllib.request.urlopen(req, timeout=60) as f:
                body = f.read()
            break
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                break
            time.sleep(2**attempt)
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2**attempt)
    else:
        raise RuntimeError(f"GIBS failed: {d} {z}/{r}/{c}")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(body)
    return body or None


def decode(body: bytes | None) -> np.ndarray:
    if body is None:
        return np.zeros((256, 256), np.uint8)
    im = Image.open(io.BytesIO(body))
    # GIBS serves some bad-granule days as unpaletted imagery with no radiance to decode.
    return np.asarray(im) if im.mode == "P" else np.zeros((256, 256), np.uint8)


def site_window(s: dict, dates: list[str], cache: str, lut: np.ndarray, sat: int, far_zoom: int | None, near_km: float) -> tuple[dict, np.ndarray, dict]:
    row0, col0, rows, cols = window(s["lat"], s["lng"], REACH_KM)
    lat = 90 - (row0 + np.arange(rows) + 0.5) / PX_PER_DEG
    lng = (col0 + np.arange(cols) + 0.5) / PX_PER_DEG - 180
    zoom = np.full((rows, cols), 8, np.int8)
    if far_zoom is not None:
        dy = (lat - s["lat"]) * KM_LAT
        dlon = lng - s["lng"]
        dx = (dlon - 360 * np.round(dlon / 360)) * KM_LON * math.cos(math.radians(s["lat"]))
        zoom[np.hypot(dx[None, :], dy[:, None]) > near_km] = far_zoom
    # Palette indices per night, no data as 255 so it sorts last.
    stack = np.full((len(dates), rows, cols), 255, np.uint8)
    cost = {}
    for z in sorted(set(np.unique(zoom).tolist())):
        y, x = merc(lat, lng, z)
        m = zoom == z
        ty, tx = y // 256, x // 256
        need = sorted({(int(a), int(b)) for a in np.unique(ty) for b in np.unique(tx)})
        need = [t for t in need if m[np.ix_(ty == t[0], tx == t[1])].any()]
        for i, d in enumerate(dates):
            with ThreadPoolExecutor(POLITE) as ex:
                bodies = list(ex.map(lambda t: fetch(cache, d, z, *t), need))
            cost.setdefault(z, []).append([len(need), sum(len(b or b"") for b in bodies)])
            for (r, c), b in zip(need, bodies):
                t = decode(b)
                mr, mc = ty == r, tx == c
                blk = t[np.ix_(y[mr] % 256, x[mc] % 256)]
                blk = np.where(blk == NODATA, 255, blk)
                cur = stack[i][np.ix_(mr, mc)]
                stack[i][np.ix_(mr, mc)] = np.where(m[np.ix_(mr, mc)], blk, cur)
    stack.sort(axis=0)
    n = (stack != 255).sum(axis=0)
    lo = np.take_along_axis(stack, np.maximum(0, (n - 1) // 2)[None], 0)[0]
    hi = np.take_along_axis(stack, np.maximum(0, n // 2)[None], 0)[0]
    lut0 = np.where(np.isnan(lut), 0, lut)
    med = np.where(n > 0, (lut0[lo] + lut0[hi]) / 2, 0)
    saturated = (n > 0) & (lo == sat) & (hi == sat)
    sat_count = round(lut[sat] / SCALE)
    counts = np.clip(np.round(med / SCALE), 0, sat_count - 1).astype("<u2")
    counts[saturated] = sat_count
    meta = {"row0": row0, "col0": col0, "rows": rows, "cols": cols, "scale": SCALE, "satCount": sat_count, "saturated": int(saturated.sum()), "nodata": int((n == 0).sum()), "nights": dates}
    return meta, counts, {str(z): v for z, v in cost.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--nights", type=int, default=8)
    ap.add_argument("--last", default="2026-09-20", help="newest night")
    ap.add_argument("--step", type=int, default=8, help="days between nights")
    ap.add_argument("--far-zoom", type=int)
    ap.add_argument("--near-km", type=float, default=32)
    ap.add_argument("--basket", action="store_true", help="DarkHours basket instead of the SQM sites")
    a = ap.parse_args()
    last = date.fromisoformat(a.last)
    dates = [(last - timedelta(days=a.step * i)).isoformat() for i in range(a.nights)]
    os.makedirs(a.out, exist_ok=True)
    os.makedirs(a.cache, exist_ok=True)
    lut, sat = palette(a.cache)
    cost = {}
    for s in sites(a.basket):
        meta, counts, c = site_window(s, dates, a.cache, lut, sat, a.far_zoom, a.near_km)
        k = key(s["name"])
        counts.tofile(os.path.join(a.out, f"{k}.u16"))
        json.dump(meta, open(os.path.join(a.out, f"{k}.json"), "w"))
        cost[k] = c
        print(k, (meta["rows"], meta["cols"]), "sat px", meta["saturated"], "nodata px", meta["nodata"], {z: v[0] for z, v in c.items()}, flush=True)
    json.dump(cost, open(os.path.join(a.out, "cost.json"), "w"))


if __name__ == "__main__":
    main()
