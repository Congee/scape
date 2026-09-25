"""Writes the synthetic VNP46A4-shaped HDF5 fixtures for hdf5.test.ts: `uv run --with h5py --with numpy scripts/viirs/h5_fixtures.py`."""

import base64
import io

import h5py
import numpy as np

GRID = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields"
N = 40


def radiance() -> np.ndarray:
    r, c = np.mgrid[0:N, 0:N]
    a = ((r * N + c) % 1000).astype(np.uint16)
    a[0, 0] = a[N - 1, N - 1] = 65535
    return a


def build(libver: str, fletcher: bool) -> bytes:
    buf = io.BytesIO()
    with h5py.File(buf, "w", libver=libver) as f:
        f.attrs["HorizontalTileNumber"] = np.bytes_("18")
        f.attrs["VerticalTileNumber"] = np.bytes_("03")
        g = f.create_group(GRID)
        for name, scale in (("AllAngle_Composite_Snow_Free", 0.1), ("NearNadir_Composite_Snow_Free", 0.1)):
            d = g.create_dataset(name, data=radiance(), chunks=(16, 16), compression="gzip", shuffle=True, fletcher32=fletcher)
            d.attrs["_FillValue"] = np.uint16(65535)
            d.attrs["scale_factor"] = np.float32(scale)
            d.attrs["offset"] = np.float32(0.0)
            d.attrs["units"] = np.bytes_("nWatts/(cm^2 sr)")
        g.create_dataset("lat", data=np.linspace(60, 50, N, dtype=np.float32))
        g.create_dataset("Radiance_f32", data=radiance().astype(np.float32) / 10, chunks=(N, N))
    return buf.getvalue()


out = ["/** Synthetic VNP46A4-shaped HDF5 files from scripts/viirs/h5_fixtures.py; not geo data. */", ""]
for key, libver, fl in (("H5_EARLIEST", "earliest", False), ("H5_LATEST", "latest", True)):
    out.append(f"export const {key} = '{base64.b64encode(build(libver, fl)).decode()}';")
open("src/lib/core/io/hdf5.fixtures.ts", "w").write("\n".join(out) + "\n")
