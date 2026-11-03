"""Explicit daily regional precipitation ingestion; never called by build/serve.

Source files are content-addressed. A complete validated release replaces the
previous directory only after every selected day has decoded successfully.
"""

import hashlib
import json
import re
import tempfile
import time
import urllib.request
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode, urlparse

from .storage import atomic_write_bytes, write_json

COLLECTION = "ch.meteoschweiz.ogd-surface-derived-grid"
CATALOG = f"https://data.geo.admin.ch/api/stac/v1/collections/{COLLECTION}/items?limit=100"
BOUNDARY = "https://api3.geo.admin.ch/rest/services/ech/MapServer/find?" + urlencode(
    {
        "layer": "ch.swisstopo.swissboundaries3d-land-flaeche.fill",
        "searchText": "CH",
        "searchField": "id",
        "returnGeometry": "true",
        "geometryFormat": "geojson",
        "sr": "2056",
        "contains": "false",
    }
)
GRID = {
    "crs": "EPSG:2056",
    "width": 370,
    "height": 265,
    "west": 2474000,
    "north": 1324000,
    "resolution": 1000,
    "encoding": "float32-le",
    "order": "north-to-south rows, west-to-east columns",
    "missing": "NaN",
}
SCHEMA = 1
PATTERN = re.compile(r"\.(rhiresd|rprelimd)_ch01h\.swiss\.lv95_(\d{14})_(\d{14})\.nc$")


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def download(url):
    """Bounded retries; callers preserve the previous release on exhaustion."""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=180) as response:
                return response.read()
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2**attempt)


def catalog_items():
    url, seen, items = CATALOG, set(), []
    while url:
        if url in seen or len(seen) >= 100 or not url.startswith(CATALOG.split("?")[0]):
            raise ValueError("Unexpected STAC pagination")
        seen.add(url)
        page = json.loads(download(url))
        items.extend(page["features"])
        links = [link["href"] for link in page.get("links", []) if link["rel"] == "next"]
        if len(links) > 1:
            raise ValueError("Ambiguous STAC next page")
        url = links[0] if links else None
    return items


def select_days(items, first, last):
    """Consolidation tier outranks modification time, on each individual date."""
    candidates = defaultdict(list)
    for item in items:
        for key, asset in item.get("assets", {}).items():
            match = PATTERN.search(key)
            if not match:
                continue
            product, start, end = match.groups()
            start, end = (
                date.fromisoformat(f"{start[:4]}-{start[4:6]}-{start[6:8]}"),
                date.fromisoformat(f"{end[:4]}-{end[4:6]}-{end[6:8]}"),
            )
            if end < first or start > last:
                continue
            if product == "rprelimd":
                tier, status, variable = 1, "preliminary", "RprelimD"
                if start != end or item["id"] != start.strftime("%Y%m%d-ch"):
                    raise ValueError("Unexpected preliminary period")
            else:
                variable = "RhiresD"
                if item["id"] == "archive-ch":
                    tier, status = 3, "annual-archive"
                    if start != date(start.year, 1, 1) or end != date(start.year, 12, 31):
                        raise ValueError("Unexpected annual period")
                elif item["id"] == start.strftime("%Y%m-ch"):
                    tier, status = 2, "consolidated-monthly"
                    if (
                        start.day != 1
                        or (end + timedelta(days=1)).day != 1
                        or start.month != end.month
                    ):
                        raise ValueError("Unexpected monthly period")
                else:
                    raise ValueError("Unexpected final-analysis item")
            checksum = asset.get("file:checksum", "").lower()
            parsed = urlparse(asset["href"])
            if (
                not re.fullmatch(r"1220[0-9a-f]{64}", checksum)
                or parsed.scheme != "https"
                or parsed.netloc != "data.geo.admin.ch"
                or not parsed.path.startswith(f"/{COLLECTION}/")
            ):
                raise ValueError("Invalid rainfall asset provenance")
            candidate = {
                "key": key,
                "asset": asset,
                "sha256": checksum[4:],
                "start": start,
                "end": end,
                "tier": tier,
                "status": status,
                "variable": variable,
                "item": item["id"],
            }
            current = max(first, start)
            while current <= min(last, end):
                candidates[current].append(candidate)
                current += timedelta(days=1)
    result = {}
    for day, options in candidates.items():
        best_tier = max(c["tier"] for c in options)
        best = [c for c in options if c["tier"] == best_tier]
        if len(best) != 1:
            raise ValueError(f"Ambiguous same-tier sources for {day}")
        result[day] = best[0]
    return result


def protect_previous(previous, selected, first, last):
    """A transient inventory omission must not silently erase or downgrade data."""
    ranks = {"preliminary": 1, "consolidated-monthly": 2, "annual-archive": 3}
    for record in previous.get("days", []):
        day = date.fromisoformat(record["date"])
        if first <= day <= last:
            if day not in selected:
                raise ValueError(
                    f"Provider inventory lost previously published day {day}; retaining previous release"
                )
            if selected[day]["tier"] < ranks[record["status"]]:
                raise ValueError(f"Provider inventory downgraded {day}; retaining previous release")


def source_file(root, candidate):
    asset = candidate["asset"]
    cache = root / "data/raw/regional"
    path = cache / f"{candidate['sha256']}.nc"
    provenance = cache / f"{candidate['sha256']}.json"
    if not path.exists():
        # Reuse a checksummed local research download, when available.
        label = candidate["item"].removesuffix("-ch")
        label = str(candidate["start"].year) if label == "archive" else label
        audited = root / "data/raw/rainfall-audit" / f"{label}.nc"
        if audited.exists() and sha256(audited.read_bytes()) == candidate["sha256"]:
            return audited, {"retrievedAt": None, "origin": "existing-audit-cache"}
        else:
            content = download(asset["href"])
            if sha256(content) != candidate["sha256"]:
                raise ValueError("Provider checksum mismatch; no release published")
            atomic_write_bytes(path, content)
            write_json(
                provenance,
                {"retrievedAt": datetime.now(UTC).isoformat(), "origin": "provider-download"},
            )
    if sha256(path.read_bytes()) != candidate["sha256"]:
        raise ValueError(
            "Cached source checksum mismatch; remove the corrupt cache file explicitly"
        )
    meta = (
        json.loads(provenance.read_text())
        if provenance.exists()
        else {"retrievedAt": None, "origin": "existing-cache"}
    )
    return path, meta


def decode_days(path, candidate, days):
    # Read NetCDF directly: no optional GDAL driver is needed on other devices.
    try:
        import numpy as np
        from netCDF4 import Dataset
    except ImportError as error:
        raise RuntimeError(
            "Install requirements-regional.txt in the repository environment"
        ) from error

    with Dataset(path) as ds:
        variable = candidate["variable"]
        field, times = ds[variable], ds["time"]
        expected = (candidate["end"] - candidate["start"]).days + 1
        east, north = np.asarray(ds["E"][:]), np.asarray(ds["N"][:])
        expected_east = GRID["west"] + GRID["resolution"] * (np.arange(GRID["width"]) + 0.5)
        expected_north = GRID["north"] - GRID["resolution"] * (np.arange(GRID["height"]) + 0.5)
        east_forward = np.array_equal(east, expected_east)
        north_forward = np.array_equal(north, expected_north)
        mapping = ds[getattr(field, "grid_mapping", "")]
        if (
            field.dimensions != ("time", "N", "E")
            or field.shape != (expected, GRID["height"], GRID["width"])
            or not (east_forward or np.array_equal(east, expected_east[::-1]))
            or not (north_forward or np.array_equal(north, expected_north[::-1]))
        ):
            raise ValueError("Unexpected regional grid geometry")
        if (
            getattr(field, "grid_name", None) != "ch01h.swiss.lv95"
            or getattr(ds["E"], "units", None) != "meters"
            or getattr(ds["N"], "units", None) != "meters"
            or getattr(mapping, "horizontal_datum_name", None) != "CH1903+"
            or getattr(mapping, "false_easting", None) != 2600000
            or getattr(mapping, "false_northing", None) != 1200000
        ):
            raise ValueError("Unexpected regional grid CRS")
        if (
            not np.array_equal(times[:], np.arange(expected))
            or times.units != f"days since {candidate['start']} 00:00:00"
            or getattr(times, "calendar", None)
            not in ("standard", "gregorian", "proleptic_gregorian")
        ):
            raise ValueError("Unexpected rainfall date axis")
        if getattr(field, "units", None) != "millimeter":
            raise ValueError("Unexpected rainfall units")
        version = getattr(field, "version", None)
        if not version:
            raise ValueError("Missing provider product version")
        result = []
        for day in days:
            index = (day - candidate["start"]).days
            a = field[index, :, :]
            if not north_forward:
                a = a[::-1, :]
            if not east_forward:
                a = a[:, ::-1]
            valid = ~np.ma.getmaskarray(a)
            values = np.asarray(a)
            if not valid.any() or np.any(valid & (~np.isfinite(values) | (values < 0))):
                raise ValueError(f"Invalid precipitation field for {day}")
            payload = np.where(valid, values, np.nan).astype("<f4").tobytes(order="C")
            result.append(
                (
                    day,
                    payload,
                    {
                        "validCells": int(valid.sum()),
                        "minMm": float(values[valid].min()),
                        "maxMm": float(values[valid].max()),
                    },
                )
            )
        return version, result


def promote(staged, output):
    """Rollback on failed promotion; readers never receive a partial manifest."""
    previous = staged.parent / "previous"
    if output.is_symlink():
        raise ValueError("Refusing symlinked regional output")
    existed = output.exists()
    if existed:
        output.rename(previous)
    try:
        staged.rename(output)
    except OSError:
        if existed:
            previous.rename(output)
        raise


def fetch_regional(root, *, days=90, through=None):
    root = Path(root)
    if not 1 <= days <= 366:
        raise ValueError("Regional release must contain 1–366 requested days")
    now = datetime.now(UTC)
    through = (
        date.fromisoformat(through)
        if through
        else now.date() - timedelta(days=1 if now.hour >= 6 else 2)
    )
    if through + timedelta(days=1) > now.date() or (
        through + timedelta(days=1) == now.date() and now.hour < 6
    ):
        raise ValueError("Requested rainfall day is not complete yet")
    first = through - timedelta(days=days - 1)
    items = catalog_items()
    selected = select_days(items, first, through)
    if not selected:
        raise ValueError("No regional data available; retaining previous release")
    if (through - max(selected)).days > 7:
        raise ValueError(
            "Provider data more than seven days behind requested date; retaining previous release"
        )
    previous_path = root / "data/raw/regional/last-release.json"
    if not previous_path.exists():
        previous_path = root / "data/processed/regional/manifest.json"
    if previous_path.exists():
        protect_previous(json.loads(previous_path.read_text()), selected, first, through)
    stage_root = root / ".cache/regional-build"
    stage_root.mkdir(parents=True, exist_ok=True)
    output = root / "data/processed/regional"
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=stage_root) as directory:
        staged = Path(directory) / "regional"
        (staged / "grids").mkdir(parents=True)
        sources, records = {}, []
        groups = defaultdict(list)
        for day, candidate in selected.items():
            groups[candidate["sha256"]].append(day)
        for identity, dates in sorted(groups.items()):
            candidate = selected[dates[0]]
            path, cache_meta = source_file(root, candidate)
            version, decoded = decode_days(path, candidate, sorted(dates))
            sources[identity] = {
                "provider": "MeteoSwiss",
                "product": candidate["variable"],
                "version": version,
                "status": candidate["status"],
                "item": candidate["item"],
                "asset": candidate["key"],
                "url": candidate["asset"]["href"],
                "sha256": identity,
                "providerUpdatedAt": candidate["asset"].get("updated"),
                "verifiedAt": datetime.now(UTC).isoformat(),
                **cache_meta,
            }
            for day, payload, stats in decoded:
                grid_hash = sha256(payload)
                grid_path = f"grids/{grid_hash}.f32"
                atomic_write_bytes(staged / grid_path, payload)
                records.append(
                    {
                        "date": str(day),
                        "sourceId": identity,
                        "status": candidate["status"],
                        "path": grid_path,
                        "sha256": grid_hash,
                        **stats,
                    }
                )
            print(
                f"Regional: verified {candidate['variable']} {version}, {len(dates)} selected day(s), {candidate['status']}",
                flush=True,
            )
        # Refresh boundary geometry on each explicit fetch; no silent stale-cache fallback.
        boundary_raw = download(BOUNDARY)
        boundary = json.loads(boundary_raw)
        features = boundary.get("results", [])
        if (
            len(features) != 1
            or features[0].get("id") != "CH"
            or features[0]["geometry"]["type"] != "MultiPolygon"
        ):
            raise ValueError("Unexpected Swiss boundary response")
        boundary_payload = json.dumps(features[0]["geometry"], separators=(",", ":")).encode()
        boundary_hash = sha256(boundary_payload)
        boundary_path = f"boundary-{boundary_hash}.json"
        atomic_write_bytes(staged / boundary_path, boundary_payload)
        records.sort(key=lambda r: r["date"])
        unavailable = [
            str(first + timedelta(days=i))
            for i in range(days)
            if first + timedelta(days=i) not in selected
        ]
        manifest = {
            "schemaVersion": SCHEMA,
            "generatedAt": datetime.now(UTC).isoformat(),
            "requestedFrom": str(first),
            "requestedThrough": str(through),
            "latestAvailable": records[-1]["date"],
            "grid": GRID,
            "period": {
                "startUTC": "06:00",
                "endUTC": "06:00 next day",
                "includesSnowWaterEquivalent": True,
            },
            "attribution": "Source: MeteoSwiss; boundary © swisstopo",
            "catalogUrl": CATALOG,
            "catalogSha256": sha256(
                json.dumps(items, sort_keys=True, separators=(",", ":")).encode()
            ),
            "boundary": {
                "path": boundary_path,
                "sha256": boundary_hash,
                "sourceUrl": BOUNDARY,
                "responseSha256": sha256(boundary_raw),
                "verifiedAt": datetime.now(UTC).isoformat(),
            },
            "sources": sources,
            "days": records,
            "unavailableDates": unavailable,
        }
        write_json(staged / "manifest.json", manifest, compact=True)
        validate_release(staged)
        promote(staged, output)
    write_json(root / "data/raw/regional/last-release.json", manifest, compact=True)
    print(
        f"Regional release: {len(records)} days, latest {records[-1]['date']}; {len(unavailable)} requested day(s) unavailable.",
        flush=True,
    )
    return manifest


def validate_release(directory):
    """Cheap offline build guard, with grid hashes and lengths checked before publishing."""
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    if (
        manifest.get("schemaVersion") != SCHEMA
        or manifest.get("grid") != GRID
        or not manifest.get("days")
    ):
        raise ValueError("Invalid regional release manifest")
    seen = set()
    for record in [manifest["boundary"], *manifest["days"]]:
        path = Path(record["path"])
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Invalid regional asset path")
        content = (directory / path).read_bytes()
        if sha256(content) != record["sha256"]:
            raise ValueError("Regional asset hash mismatch")
        if "date" in record:
            if len(content) != GRID["width"] * GRID["height"] * 4 or record["date"] in seen:
                raise ValueError("Invalid daily grid payload")
            seen.add(record["date"])
            source = manifest["sources"][record["sourceId"]]
            if source["sha256"] != record["sourceId"] or source["status"] != record["status"]:
                raise ValueError("Daily source/status mismatch")
    if manifest["latestAvailable"] != max(seen) or seen & set(manifest["unavailableDates"]):
        raise ValueError("Regional date coverage mismatch")
    expected = {
        str(date.fromisoformat(manifest["requestedFrom"]) + timedelta(days=i))
        for i in range(
            (
                date.fromisoformat(manifest["requestedThrough"])
                - date.fromisoformat(manifest["requestedFrom"])
            ).days
            + 1
        )
    }
    if seen | set(manifest["unavailableDates"]) != expected:
        raise ValueError("Regional requested dates not accounted for")
    return manifest
