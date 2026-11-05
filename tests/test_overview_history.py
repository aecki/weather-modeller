"""Independent real-data regression checks for the nationwide monthly summary."""

import gzip
import hashlib
import json
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class OverviewHistoryTests(unittest.TestCase):
    def test_all_summary_chunks_are_versioned_complete_and_match_independent_cells(self):
        folder = ROOT / "data/reference/rainfall-summary"
        manifest = json.loads((folder / "manifest.json").read_text())
        reference = json.loads((ROOT / "tests/fixtures/overview-history.json").read_text())
        requested = {r["cell"]: r for r in reference["records"]}
        found = {}
        previous = -1
        count = 0
        for chunk in manifest["chunks"]:
            raw = (folder / chunk["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), chunk["sha256"])
            rows = json.loads(gzip.decompress(raw))
            year_raw = (folder / chunk["yearPath"]).read_bytes()
            self.assertEqual(hashlib.sha256(year_raw).hexdigest(), chunk["yearSha256"])
            year_bytes = gzip.decompress(year_raw)
            self.assertEqual(len(year_bytes), len(rows) * 65 * 12 * 2)
            for position, row in enumerate(rows):
                if row["cell"] in requested:
                    expected = requested[row["cell"]]["yearMonths"]
                    for yi, months in enumerate(expected):
                        for mi, total in enumerate(months):
                            stored = struct.unpack_from(
                                "<H", year_bytes, ((position * 65 + yi) * 12 + mi) * 2
                            )[0]
                            if total is None:
                                self.assertEqual(stored, 65535)
                            else:
                                self.assertLessEqual(abs(stored / 10 - total), 0.050001)

            self.assertEqual(rows[0]["cell"], chunk["first"])
            self.assertEqual(rows[-1]["cell"], chunk["last"])
            for row in rows:
                self.assertGreater(row["cell"], previous)
                previous = row["cell"]
                self.assertEqual(len(row["months"]), 12)
                if row["cell"] in requested:
                    found[row["cell"]] = row
                for duration, extremes in row["extremes"].items():
                    for i, (value, day) in enumerate(extremes):
                        self.assertGreaterEqual(value, 0)
                        if i:
                            self.assertLessEqual(value, extremes[i - 1][0])
                        self.assertTrue(all(abs(day - d) >= int(duration) for _, d in extremes[:i]))
                count += 1
        self.assertEqual(count, 42487)
        self.assertEqual(found.keys(), requested.keys())
        for cell, expected in requested.items():
            row = found[cell]
            for key in ("months", "annual", "extremes"):

                def compare(actual, target):
                    if isinstance(target, list):
                        self.assertEqual(len(actual), len(target))
                        for a, b in zip(actual, target, strict=True):
                            compare(a, b)
                    elif isinstance(target, dict):
                        self.assertEqual(actual.keys(), target.keys())
                        for k, v in target.items():
                            compare(actual[k], v)
                    elif isinstance(target, (int, float)):
                        self.assertAlmostEqual(actual, target, places=7)
                    else:
                        self.assertEqual(actual, target)

                compare(row[key], expected[key])


if __name__ == "__main__":
    unittest.main()
