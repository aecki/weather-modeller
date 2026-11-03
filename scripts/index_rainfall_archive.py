"""Create a small range index of real annual NetCDF data, not copied rainfall."""

import hashlib
import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
    raise SystemExit("Use the repository environment")
sys.path.insert(0, str(ROOT / "src"))
import h5py
import numpy as np

from weather_modeller.regional import GRID, decode_days, source_file
from weather_modeller.regional_history import validate_history
from weather_modeller.storage import write_json


def prepare(root=ROOT):
    config = json.loads((root / "config/regional-history.json").read_text())
    baseline = validate_history(root / "data/processed/regional-history", config["manifestSha256"])
    output = root / "data/reference/rainfall-archive"
    output.mkdir(parents=True, exist_ok=True)
    years = {}
    for source in baseline["sources"]:
        year = source["year"]
        first, last = date(year, 1, 1), date(year, 12, 31)
        candidate = {
            "asset": {"href": source["url"]},
            "sha256": source["sha256"],
            "item": "archive-ch",
            "start": first,
            "end": last,
            "variable": "RhiresD",
        }
        path, _ = source_file(root, candidate)
        dates = [first + timedelta(days=i) for i in range((last - first).days + 1)]
        version, decoded = decode_days(path, candidate, dates)
        with h5py.File(path) as handle, path.open("rb") as stream:
            field = handle["RhiresD"]
            if (
                field.chunks != (1, GRID["height"], GRID["width"])
                or field.dtype.str != "<f4"
                or field.id.get_create_plist().get_nfilters() != 0
            ):
                raise ValueError(f"Unsupported raw chunk encoding: {year}")
            flip_north = bool(handle["N"][0] < handle["N"][-1])
            flip_east = bool(handle["E"][0] > handle["E"][-1])
            fill = float(field.attrs["_FillValue"][0])
            chunks = []
            for i, (day, payload, _) in enumerate(decoded):
                info = field.id.get_chunk_info_by_coord((i, 0, 0))
                if info.filter_mask or info.size != GRID["height"] * GRID["width"] * 4:
                    raise ValueError("Invalid daily raw chunk")
                stream.seek(info.byte_offset)
                raw = stream.read(info.size)
                a = np.frombuffer(raw, dtype="<f4").reshape(GRID["height"], GRID["width"])
                if flip_north:
                    a = a[::-1]
                if flip_east:
                    a = a[:, ::-1]
                normalized = np.where(a == fill, np.nan, a).astype("<f4").tobytes()
                if normalized != payload:
                    raise ValueError(f"Raw range differs from verified NetCDF decoder on {day}")
                chunks.append(
                    [
                        info.byte_offset,
                        hashlib.sha256(raw).hexdigest(),
                        hashlib.sha256(payload).hexdigest(),
                    ]
                )
            metadata = {
                "schemaVersion": 1,
                "year": year,
                "source": source,
                "version": version,
                "grid": GRID,
                "length": GRID["height"] * GRID["width"] * 4,
                "flipNorth": flip_north,
                "flipEast": flip_east,
                "fillValue": fill,
                "days": chunks,
            }
        encoded = (json.dumps(metadata, separators=(",", ":")) + "\n").encode()
        digest = hashlib.sha256(encoded).hexdigest()
        filename = f"{year}-{digest}.json"
        (output / filename).write_bytes(encoded)
        years[str(year)] = {"path": filename, "sha256": digest}
        print(f"Indexed and independently decoded every daily range: {year}", flush=True)
    write_json(
        output / "manifest.json",
        {
            "schemaVersion": 1,
            "historyReferenceId": baseline["referenceId"],
            "from": f"{min(baseline['years'])}-01-01",
            "through": f"{max(baseline['years'])}-12-31",
            "years": years,
            "attribution": "Source: MeteoSwiss",
        },
        compact=True,
    )


if __name__ == "__main__":
    prepare()
