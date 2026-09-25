"""Synthetic full-size VNP46A4 tiles for bortle.sh, written to argv[1]; made-up lights, not geo data.
Usage: uv run --with h5py --with numpy scripts/smoke/bortle-tiles.py <dir> [year]"""

import os
import sys

import h5py
import numpy as np

GRID = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields"
PX = 2400
OUT = sys.argv[1]
YEAR = int(sys.argv[2]) if len(sys.argv) > 2 else 2024

# Per tile: a floor in nW/(cm² sr), then (lat, lon, peak, sigma km) Gaussian towns.
TILES = {
    (18, 3): (0.3, [(51.92, 4.48, 60.0, 6.0), (52.07, 4.30, 40.0, 5.0), (52.37, 4.90, 50.0, 7.0)]),
    (18, 4): (0.3, [(49.61, 6.13, 30.0, 4.0)]),
    (19, 4): (0.05, [(46.36, 17.79, 20.0, 2.0)]),
}


def radiance(h: int, v: int, floor: float, towns) -> np.ndarray:
    top, left = 90 - 10 * v, -180 + 10 * h
    lat = top - (np.arange(PX) + 0.5) / 240
    lon = left + (np.arange(PX) + 0.5) / 240
    la, lo = np.meshgrid(lat, lon, indexing="ij")
    r = np.full((PX, PX), floor)
    for tlat, tlon, peak, sig in towns:
        dy = (la - tlat) * 110.574
        dx = (lo - tlon) * 111.32 * np.cos(np.radians(tlat))
        r += peak * np.exp(-(dx * dx + dy * dy) / (2 * sig * sig))
    return np.minimum(np.round(r * 10), 65534).astype(np.uint16)


os.makedirs(OUT, exist_ok=True)
for (h, v), (floor, towns) in TILES.items():
    name = f"VNP46A4.A{YEAR}001.h{h:02d}v{v:02d}.002.2025000000000.h5"
    with h5py.File(os.path.join(OUT, name), "w") as f:
        f.attrs["HorizontalTileNumber"] = np.bytes_(f"{h:02d}")
        f.attrs["VerticalTileNumber"] = np.bytes_(f"{v:02d}")
        g = f.create_group(GRID)
        d = g.create_dataset("AllAngle_Composite_Snow_Free", data=radiance(h, v, floor, towns), chunks=(240, 240), compression="gzip", shuffle=True)
        d.attrs["_FillValue"] = np.uint16(65535)
        d.attrs["scale_factor"] = np.float32(0.1)
        d.attrs["offset"] = np.float32(0.0)
    print(name)
