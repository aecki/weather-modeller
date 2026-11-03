"""Regional spatial aggregation and complete-year extrema checks."""

import gzip
import json
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.regional_models import annual_summary, rectangle_sums, regional_means


class RegionalModelTests(unittest.TestCase):
    def test_real_65_year_reference_matches_independent_daily_reads(self):
        folder = ROOT / "tests/fixtures/regional-models"
        reference = json.loads((folder / "reference.json").read_text())
        raw = gzip.decompress((folder / "bern-daily.f64.gz").read_bytes())
        import hashlib

        self.assertEqual(hashlib.sha256(raw).hexdigest(), reference["bernDailySha256"])
        values = np.frombuffer(raw, dtype="<f8")
        cursor = 0
        for i, year in enumerate(reference["years"]):
            n = 366 if __import__("calendar").isleap(year) else 365
            actual = annual_summary(values[cursor : cursor + n, None])[0]
            np.testing.assert_allclose(actual, reference["cells"][0]["years"][i], rtol=0, atol=1e-7)
            cursor += n
        self.assertEqual(cursor, len(values))

    def test_missing_footprint_cell_does_not_shrink_the_region(self):
        mask = np.ones((3, 3), dtype=bool)
        bounds = tuple(np.array([n]) for n in (0, 0, 3, 3))
        field = np.arange(9, dtype=float).reshape(3, 3)
        self.assertEqual(regional_means(field, mask, bounds, np.array([9]))[0], 4)
        field[0, 0] = np.nan
        self.assertTrue(np.isnan(regional_means(field, mask, bounds, np.array([9]))[0]))
        mask[0, 0] = False
        self.assertEqual(regional_means(field, mask, bounds, np.array([8]))[0], 4.5)

    def test_incomplete_year_is_omitted_and_windows_stay_in_year(self):
        values = np.zeros((365, 2))
        values[0] = 10
        values[-1] = 20
        values[50, 1] = np.nan
        result = annual_summary(values)
        self.assertEqual(result[0, 4], 20)
        self.assertEqual(result[0, 6], 20)
        self.assertTrue(np.isnan(result[1]).all())

    def test_integral_rectangle_matches_direct_sum(self):
        a = np.arange(30).reshape(5, 6)
        bounds = tuple(np.array([n]) for n in (1, 2, 5, 6))
        self.assertEqual(rectangle_sums(a, bounds)[0], a[1:5, 2:6].sum())
