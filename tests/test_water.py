"""Recovery regressions: censoring, unsupported horizons and sparse histories."""

import gzip
import importlib.util
import json
import statistics
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare_water", ROOT / "scripts/prepare_water.py")
water = importlib.util.module_from_spec(spec)
spec.loader.exec_module(water)


class WaterTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("numpy"), "Optional preparation dependency")
    def test_real_sarnen_band_recovery_and_non_recoveries(self):
        fixture = json.loads(
            gzip.decompress((ROOT / "tests/fixtures/lake-sarnen.json.gz").read_bytes())
        )
        result = water.analyse(fixture["rows"])
        self.assertEqual(result["latest"], fixture["expected"]["latest"])
        self.assertEqual(result["recovery"], fixture["expected"]["recovery"])
        current = date.fromisoformat(result["latest"])

        def position(d):
            return (date(2000, d.month, d.day) - date(2000, 1, 1)).days

        selected = []
        for day, value, *_ in fixture["rows"]:
            d = date.fromisoformat(day)
            delta = abs(position(d) - position(current))
            if 1991 <= d.year <= 2020 and value is not None and min(delta, 366 - delta) <= 15:
                selected.append(value)
        quartiles = statistics.quantiles(selected, n=4, method="inclusive")
        for actual, expected in zip(result["band"], quartiles, strict=True):
            self.assertAlmostEqual(actual, expected, places=10)
        cases = result["recovery"]["cases"]
        self.assertEqual(len({c["start"][:4] for c in cases}), len(cases))
        self.assertTrue(all(c["start"][5:] == result["latest"][5:] for c in cases))
        self.assertTrue(all(c["start"][:4] < result["latest"][:4] for c in cases))
        self.assertEqual(result["recovery"]["matches"], 12)
        self.assertEqual(result["recovery"]["medianDays"], 24)

    def test_censoring_is_not_counted_as_recovery(self):
        result = water.kaplan_meier([[10, True], [20, False], [30, True], [180, False]])
        self.assertEqual(result["medianDays"], 30)
        self.assertAlmostEqual(result["recoveredBy180"], 0.625)

    def test_unsupported_horizon_is_not_extrapolated(self):
        result = water.kaplan_meier([[10, True], [20, False], [30, False]])
        self.assertIsNone(result["medianDays"])
        self.assertIsNone(result["recoveredBy180"])

    def test_all_observed_recoveries_and_no_recoveries(self):
        self.assertEqual(water.kaplan_meier([[7, True], [14, True]])["medianDays"], 7)
        result = water.kaplan_meier([[180, False], [180, False]])
        self.assertIsNone(result["medianDays"])
        self.assertEqual(result["recoveredBy180"], 0)


if __name__ == "__main__":
    unittest.main()
