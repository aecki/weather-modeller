"""Versioned, lossless historical frequency summaries from real annual RhiresD.

Only explicit preparation reads the national archive. Daily deployment restores
an immutable reference artifact; browsers fetch one cell chunk for one month.
"""

import gzip
import io
import json
import os
import re
import struct
import tarfile
import tempfile
import urllib.error
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from .regional import (
    BOUNDARY,
    GRID,
    catalog_items,
    decode_days,
    download,
    promote,
    select_days,
    sha256,
    source_file,
)
from .storage import atomic_write_bytes, write_json

LEVELS = [
    0,
    0.1,
    0.25,
    0.5,
    0.75,
    1,
    1.25,
    1.5,
    1.75,
    2,
    2.5,
    3,
    3.5,
    4,
    4.5,
    5,
    6,
    7,
    8,
    9,
    10,
    12,
    14,
    16,
    18,
    20,
    22,
    24,
    26,
    28,
    30,
    35,
    40,
    45,
    50,
    55,
    60,
    65,
    70,
    75,
    80,
    90,
    100,
    110,
    120,
    130,
    140,
    150,
    175,
    200,
    225,
    250,
    275,
    300,
    350,
    400,
    450,
    500,
    600,
]
CHUNK = 256


def gzip_bytes(raw):
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", filename="", mtime=0, compresslevel=6) as stream:
        stream.write(raw)
    return buffer.getvalue()


def monthly_counts(values, levels):
    """One row per day, one column per cell; omit incomplete month/cell records."""
    import numpy as np

    if np.isinf(values).any():
        raise ValueError("Infinite historical precipitation")
    complete = np.isfinite(values).all(axis=0)
    if np.any(np.isfinite(values) & (values < 0)):
        raise ValueError("Negative historical precipitation")
    return np.stack([np.sum(values >= level, axis=0) * complete for level in levels]).astype("u1")


def prepare_history(root, start=1961, end=2025):
    import numpy as np
    import shapely
    from shapely.geometry import shape

    root = Path(root)
    if not 20 <= end - start + 1 <= 100:
        raise ValueError("Historical reference requires 20–100 complete years")
    items = catalog_items()
    selected = select_days(items, date(start, 1, 1), date(end, 12, 31))
    boundary_raw = download(BOUNDARY)
    geometry = json.loads(boundary_raw)["results"][0]["geometry"]
    region = shape(geometry).buffer(50)
    shapely.prepare(region)
    row, col = np.mgrid[: GRID["height"], : GRID["width"]]
    x = GRID["west"] + col.ravel() * 1000
    y = GRID["north"] - row.ravel() * 1000
    cells = np.flatnonzero(
        shapely.intersects(region, shapely.box(x, y - 1000, x + 1000, y))
    ).astype("<u4")
    levels = np.asarray(LEVELS, dtype="<f4")
    years = list(range(start, end + 1))
    cache = root / ".cache/history-build"
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache) as directory:
        staging = Path(directory) / "history"
        (staging / "months").mkdir(parents=True)
        counts = np.lib.format.open_memmap(
            Path(directory) / "counts.npy",
            mode="w+",
            dtype="u1",
            shape=(12, len(years), len(levels), len(cells)),
        )
        sources = []
        for yi, year in enumerate(years):
            first, last = date(year, 1, 1), date(year, 12, 31)
            dates = [first + timedelta(days=i) for i in range((last - first).days + 1)]
            candidate = selected.get(first)
            if (
                not candidate
                or candidate["status"] != "annual-archive"
                or any(selected.get(d, {}).get("sha256") != candidate["sha256"] for d in dates)
            ):
                raise ValueError(f"Incomplete annual reference inventory for {year}")
            path, provenance = source_file(root, candidate)
            version, fields = decode_days(path, candidate, dates)
            for month in range(1, 13):
                matrix = np.stack(
                    [
                        np.frombuffer(payload, dtype="<f4")[cells]
                        for day, payload, _ in fields
                        if day.month == month
                    ]
                )
                counts[month - 1, yi] = monthly_counts(matrix, levels)
            sources.append(
                {
                    "year": year,
                    "product": "RhiresD",
                    "version": version,
                    "sha256": candidate["sha256"],
                    "url": candidate["asset"]["href"],
                    "providerUpdatedAt": candidate["asset"].get("updated"),
                    "verifiedAt": datetime.now(UTC).isoformat(),
                    **provenance,
                }
            )
            print(f"Historical reference: {year}, complete annual source verified", flush=True)
        counts.flush()
        cell_payload = cells.tobytes()
        atomic_write_bytes(staging / "cells.u32", cell_payload)
        chunks = {}
        for month in range(1, 13):
            hashes = []
            for at in range(0, len(cells), CHUNK):
                payload = (
                    np.asarray(counts[month - 1, :, :, at : at + CHUNK])
                    .transpose(2, 0, 1)
                    .tobytes()
                )
                compressed = gzip_bytes(payload)
                digest = sha256(compressed)
                atomic_write_bytes(
                    staging / f"months/{month:02}-{at // CHUNK}-{digest}.u8.gz", compressed
                )
                hashes.append(digest)
            chunks[str(month)] = hashes
            print(
                f"Historical reference: month {month}, {len(hashes)} compressed chunks", flush=True
            )
        settings = {
            "schemaVersion": 1,
            "years": years,
            "thresholds": levels.astype(float).tolist(),
            "grid": GRID,
            "chunkSize": CHUNK,
            "cellCount": len(cells),
            "cellsSha256": sha256(cell_payload),
            "boundaryResponseSha256": sha256(boundary_raw),
            "sourceHashes": [s["sha256"] for s in sources],
        }
        reference_id = sha256(json.dumps(settings, sort_keys=True, separators=(",", ":")).encode())
        manifest = {
            **settings,
            "referenceId": reference_id,
            "generatedAt": datetime.now(UTC).isoformat(),
            "sources": sources,
            "chunks": chunks,
            "encoding": "uint8 counts at-or-above thresholds; cell/year/threshold",
            "completeness": "Only complete calendar month/cell records. Zero denominator excludes a month-year.",
            "coverage": "Cells intersecting the Swiss national polygon buffered by 50 metres; no relocation of address coordinates.",
            "attribution": "Source: MeteoSwiss; boundary © swisstopo",
        }
        write_json(staging / "manifest.json", manifest, compact=True)
        validate_history(staging)
        output = root / "data/processed/regional-history"
        output.parent.mkdir(parents=True, exist_ok=True)
        promote(staging, output)
        del counts
    return package_reference(root, output, "regional-history", reference_id)


def package_reference(root, output, name, reference_id):
    archive = root / f"outputs/{name}.tar.gz"
    archive.parent.mkdir(parents=True, exist_ok=True)
    with (
        archive.open("wb") as raw,
        gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0, compresslevel=6) as gz,
        tarfile.open(fileobj=gz, mode="w|") as tar,
    ):
        for path in sorted(output.rglob("*")):
            if path.is_file():
                info = tarfile.TarInfo(str(path.relative_to(output)).replace("\\", "/"))
                info.size = path.stat().st_size
                info.mode = 0o644
                info.mtime = 0
                with path.open("rb") as stream:
                    tar.addfile(info, stream)
    metadata = {
        "referenceId": reference_id,
        "archiveSha256": sha256(archive.read_bytes()),
        "archiveBytes": archive.stat().st_size,
        "fileCount": sum(1 for p in output.rglob("*") if p.is_file()),
    }
    write_json(root / f"outputs/{name}-build.json", metadata)
    print(json.dumps(metadata), flush=True)
    return metadata


def validate_history(directory, expected_manifest_sha=None):
    directory = Path(directory)
    manifest_bytes = (directory / "manifest.json").read_bytes()
    if expected_manifest_sha and sha256(manifest_bytes) != expected_manifest_sha:
        raise ValueError("Historical manifest checksum mismatch")
    m = json.loads(manifest_bytes)
    keys = [
        "schemaVersion",
        "years",
        "thresholds",
        "grid",
        "chunkSize",
        "cellCount",
        "cellsSha256",
        "boundaryResponseSha256",
        "sourceHashes",
    ]
    identity = sha256(
        json.dumps({key: m[key] for key in keys}, sort_keys=True, separators=(",", ":")).encode()
    )
    if identity != m["referenceId"]:
        raise ValueError("Historical reference identity mismatch")
    if (
        m.get("schemaVersion") != 1
        or m.get("grid") != GRID
        or len(m.get("years", [])) < 20
        or m.get("chunkSize") != CHUNK
    ):
        raise ValueError("Invalid historical reference schema")
    cells = (directory / "cells.u32").read_bytes()
    if len(cells) != m["cellCount"] * 4 or sha256(cells) != m["cellsSha256"]:
        raise ValueError("Historical cell index failed integrity check")
    indices = [value[0] for value in struct.iter_unpack("<I", cells)]
    if (
        any(a >= b for a, b in zip(indices, indices[1:], strict=False))
        or not indices
        or indices[0] < 0
        or indices[-1] >= GRID["width"] * GRID["height"]
    ):
        raise ValueError("Invalid historical cell ordering")
    for month in range(1, 13):
        hashes = m["chunks"][str(month)]
        if len(hashes) != (m["cellCount"] + CHUNK - 1) // CHUNK:
            raise ValueError("Incomplete historical month chunks")
        for i, digest in enumerate(hashes):
            if not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise ValueError("Invalid historical chunk hash")
            path = directory / f"months/{month:02}-{i}-{digest}.u8.gz"
            if sha256(path.read_bytes()) != digest:
                raise ValueError("Historical chunk failed integrity check")
    return m


def restore_history(root, name="regional-history"):
    validator = validate_history
    if name == "regional-models":
        from .regional_models import validate_models

        validator = validate_models
    elif name != "regional-history":
        raise ValueError("Unknown reference")
    root = Path(root)
    config = json.loads((root / f"config/{name}.json").read_text())
    output = root / f"data/processed/{name}"
    if output.exists():
        m = validator(output, config["manifestSha256"])
        if m["referenceId"] == config["referenceId"]:
            return m
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError(
            "A GitHub token is required to restore the private reference asset; local preparation is also supported"
        )
    asset_id = config.get("assetId")
    if not asset_id:
        from urllib.parse import quote

        tag = quote(config["releaseTag"], safe="")
        request = urllib.request.Request(
            f"https://api.github.com/repos/aecki/weather-modeller/releases/tags/{tag}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            release = json.load(response)
        assets = [asset for asset in release["assets"] if asset["name"] == config["assetName"]]
        if len(assets) != 1:
            raise ValueError("Pinned reference release asset is missing or ambiguous")
        asset_id = assets[0]["id"]
    url = f"https://api.github.com/repos/aecki/weather-modeller/releases/assets/{int(asset_id)}"

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/octet-stream",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=180) as response:
            archive = response.read()
    except urllib.error.HTTPError as error:
        if error.code not in (301, 302, 303, 307, 308):
            raise
        # Never forward GitHub authorization headers to the signed storage URL.
        archive = download(error.headers["Location"])
    if sha256(archive) != config["archiveSha256"]:
        raise ValueError("Historical reference archive checksum mismatch")
    cache = root / ".cache/history-build"
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache) as directory:
        staged = Path(directory) / "history"
        staged.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
            tar.extractall(staged, filter="data")
        m = validator(staged, config["manifestSha256"])
        if m["referenceId"] != config["referenceId"]:
            raise ValueError("Historical reference identity mismatch")
        output.parent.mkdir(parents=True, exist_ok=True)
        promote(staged, output)
    return m
