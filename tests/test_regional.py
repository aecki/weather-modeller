"""Regional source precedence, real-data decoding, revision and release rollback."""

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.regional import (
    GRID,
    decode_days,
    fetch_regional,
    promote,
    protect_previous,
    select_days,
    sha256,
    source_file,
    validate_release,
)

FIXTURE = ROOT / "tests/fixtures/regional"
REFERENCE = json.loads((FIXTURE / "reference.json").read_text())
DAY = date(2026, 9, 16)


def item(kind, updated="2026-11-03T00:00:00Z"):
    # Isolated catalogue fixtures refer to the real single-day download where used.
    product = "rprelimd" if kind == "preliminary" else "rhiresd"
    period = (
        ("20260916000000", "20260916000000")
        if kind == "preliminary"
        else ("20260901000000", "20260930000000")
        if kind == "monthly"
        else ("20260101000000", "20261231000000")
    )
    identifier = (
        "20260916-ch"
        if kind == "preliminary"
        else "202609-ch"
        if kind == "monthly"
        else "archive-ch"
    )
    key = f"fixture.{product}_ch01h.swiss.lv95_{period[0]}_{period[1]}.nc"
    return {
        "id": identifier,
        "assets": {
            key: {
                **REFERENCE["source"],
                "file:checksum": "1220" + REFERENCE["fixtureSha256"],
                "updated": updated,
            }
        },
    }


class RegionalTests(unittest.TestCase):
    def setUp(self):
        parent = ROOT / ".cache/tmp"
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_consolidation_outranks_provider_modification_time(self):
        result = select_days(
            [item("preliminary"), item("monthly"), item("annual", "2026-01-01T00:00:00Z")], DAY, DAY
        )
        self.assertEqual(result[DAY]["status"], "annual-archive")
        self.assertEqual(
            select_days([item("preliminary"), item("monthly")], DAY, DAY)[DAY]["status"],
            "consolidated-monthly",
        )
        self.assertEqual(select_days([item("preliminary")], DAY, DAY)[DAY]["status"], "preliminary")
        self.assertEqual(select_days([], DAY, DAY), {})

    def test_ambiguous_versions_and_bad_provenance_fail(self):
        with self.assertRaisesRegex(ValueError, "Ambiguous"):
            select_days([item("monthly"), item("monthly")], DAY, DAY)
        value = item("preliminary")
        next(iter(value["assets"].values()))["href"] = "https://example.com/wrong.nc"
        with self.assertRaisesRegex(ValueError, "provenance"):
            select_days([value], DAY, DAY)

    def test_missing_or_downgraded_inventory_preserves_previous(self):
        previous = {"days": [{"date": str(DAY), "status": "annual-archive"}]}
        with self.assertRaisesRegex(ValueError, "lost previously"):
            protect_previous(previous, {}, DAY, DAY)
        selected = select_days([item("monthly")], DAY, DAY)
        with self.assertRaisesRegex(ValueError, "downgraded"):
            protect_previous(previous, selected, DAY, DAY)
        protect_previous(previous, {}, date(2026, 10, 1), date(2026, 10, 2))

    def test_cached_corruption_is_not_silently_used(self):
        candidate = select_days([item("preliminary")], DAY, DAY)[DAY]
        path = self.root / "data/raw/regional" / f"{candidate['sha256']}.nc"
        path.parent.mkdir(parents=True)
        path.write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "Cached source checksum"):
            source_file(self.root, candidate)

    def test_changed_provider_hash_fetches_new_version(self):
        original = select_days([item("preliminary")], DAY, DAY)[DAY]
        first = b"isolated cache fixture one"
        second = b"isolated cache fixture two"
        for content in (first, second):
            candidate = {**original, "sha256": sha256(content)}
            with patch("weather_modeller.regional.download", return_value=content) as request:
                path, _ = source_file(self.root, candidate)
                self.assertEqual(path.read_bytes(), content)
                request.assert_called_once()
        self.assertEqual(len(list((self.root / "data/raw/regional").glob("*.nc"))), 2)

    def test_failed_promotion_restores_previous_release(self):
        output = self.root / "published"
        output.mkdir()
        (output / "manifest.json").write_text("previous")
        staging = self.root / "staging"
        staging.mkdir()
        new = staging / "regional"
        new.mkdir()
        original = Path.rename

        def fail(source, destination):
            if source == new:
                raise OSError("isolated promotion failure")
            return original(source, destination)

        with patch("weather_modeller.regional.Path.rename", fail), self.assertRaises(OSError):
            promote(new, output)
        self.assertEqual((output / "manifest.json").read_text(), "previous")

    @unittest.skipUnless(
        importlib.util.find_spec("netCDF4"), "optional regional NetCDF dependencies not installed"
    )
    def test_real_provider_file_preserves_zero_missingness_and_axes(self):
        candidate = select_days([item("preliminary")], DAY, DAY)[DAY]
        version, result = decode_days(FIXTURE / "rprelim-20260916-derived.nc", candidate, [DAY])
        self.assertEqual(version, REFERENCE["version"])
        self.assertEqual(result[0][1], (FIXTURE / "20260916.f32").read_bytes())
        self.assertEqual(sha256(result[0][1]), REFERENCE["payloadSha256"])
        self.assertEqual(len(result[0][1]), GRID["width"] * GRID["height"] * 4)
        wrong = {**candidate, "start": date(2026, 9, 15), "end": date(2026, 9, 15)}
        with self.assertRaisesRegex(ValueError, "date axis"):
            decode_days(FIXTURE / "rprelim-20260916-derived.nc", wrong, [date(2026, 9, 15)])

    @unittest.skipUnless(
        importlib.util.find_spec("netCDF4"), "optional NetCDF dependencies not installed"
    )
    def test_axis_order_and_invalid_source_values(self):
        from netCDF4 import Dataset

        candidate = select_days([item("preliminary")], DAY, DAY)[DAY]
        path = self.root / "reversed.nc"
        shutil.copyfile(FIXTURE / "rprelim-20260916-derived.nc", path)
        with Dataset(path, "r+") as ds:
            east, north, values = ds["E"][:], ds["N"][:], ds["RprelimD"][:]
            ds["E"][:] = east[::-1]
            ds["N"][:] = north[::-1]
            # Preserve every real coordinate/value pair, changing only storage order.
            ds["RprelimD"][:] = values[:, ::-1, ::-1]
        self.assertEqual(
            decode_days(path, candidate, [DAY])[1][0][1], (FIXTURE / "20260916.f32").read_bytes()
        )
        for invalid in (-1.0, float("inf")):
            shutil.copyfile(FIXTURE / "rprelim-20260916-derived.nc", path)
            with Dataset(path, "r+") as ds:
                # Deliberately corrupt one observed cell in an isolated test copy.
                ds["RprelimD"][0, 140, 126] = invalid
            with self.assertRaisesRegex(ValueError, "Invalid precipitation"):
                decode_days(path, candidate, [DAY])

    @unittest.skipUnless(
        importlib.util.find_spec("netCDF4"), "optional regional NetCDF dependencies not installed"
    )
    def test_real_release_then_failed_fetch_keeps_previous(self):
        geometry = {
            "results": [
                {
                    "id": "CH",
                    "geometry": {
                        "type": "MultiPolygon",
                        "coordinates": [[[[0, 0], [1, 0], [1, 1], [0, 0]]]],
                    },
                }
            ]
        }

        def request(url):
            return (
                json.dumps(geometry).encode()
                if "/find?" in url
                else (FIXTURE / "rprelim-20260916-derived.nc").read_bytes()
            )

        with (
            patch("weather_modeller.regional.catalog_items", return_value=[item("preliminary")]),
            patch("weather_modeller.regional.download", side_effect=request),
        ):
            manifest = fetch_regional(self.root, days=2, through="2026-09-16")
        self.assertEqual(manifest["unavailableDates"], ["2026-09-15"])
        output = self.root / "data/processed/regional"
        self.assertEqual(validate_release(output)["latestAvailable"], "2026-09-16")
        before = (output / "manifest.json").read_bytes()
        with (
            patch(
                "weather_modeller.regional.catalog_items", side_effect=OSError("isolated outage")
            ),
            self.assertRaises(OSError),
        ):
            fetch_regional(self.root, days=2, through="2026-09-16")
        self.assertEqual((output / "manifest.json").read_bytes(), before)
        (output / manifest["days"][0]["path"]).write_bytes(b"broken")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            validate_release(output)


if __name__ == "__main__":
    unittest.main()
