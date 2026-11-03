"""Integrity and complete calendar coverage of the committed byte-range index."""

import calendar
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ArchiveIndexTests(unittest.TestCase):
    def test_all_65_source_years_have_complete_checksummed_daily_ranges(self):
        directory = ROOT / "data/reference/rainfall-archive"
        index = json.loads((directory / "manifest.json").read_text())
        baseline = json.loads((ROOT / "tests/fixtures/regional-models/reference.json").read_text())
        sources = {source["year"]: source for source in baseline["sources"]}
        self.assertEqual(set(index["years"]), {str(y) for y in range(1961, 2026)})
        for year, slot in index["years"].items():
            raw = (directory / slot["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), slot["sha256"])
            m = json.loads(raw)
            self.assertEqual(m["source"]["sha256"], sources[int(year)]["sha256"])
            self.assertEqual(m["version"], sources[int(year)]["version"])
            self.assertEqual(len(m["days"]), 366 if calendar.isleap(int(year)) else 365)
            self.assertEqual(m["length"], 392200)
            self.assertTrue(m["source"]["url"].startswith("https://data.geo.admin.ch/"))
            for offset, raw_hash, normalized_hash in m["days"]:
                self.assertGreaterEqual(offset, 0)
                self.assertRegex(raw_hash, r"^[0-9a-f]{64}$")
                self.assertRegex(normalized_hash, r"^[0-9a-f]{64}$")
            offsets = [row[0] for row in m["days"]]
            self.assertTrue(
                all(b - a >= 392200 for a, b in zip(offsets, offsets[1:], strict=False))
            )
