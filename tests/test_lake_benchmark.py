"""Real-data benchmark regression and origin-time availability safeguards."""

import gzip
import hashlib
import importlib.util
import json
import unittest
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class LakeBenchmarkSources(unittest.TestCase):
    def test_input_versions_and_complete_calendar(self):
        report = json.loads((ROOT / "data/reference/lake-benchmark.json").read_text())
        for lake in report["lakes"]:
            raw = (ROOT / "data/reference" / lake["inputPath"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), lake["inputSha256"])
            rows = json.loads(gzip.decompress(raw))
            first = date.fromisoformat(rows[0][0])
            for i, row in enumerate(rows):
                self.assertEqual(row[0], str(first + timedelta(days=i)))
            self.assertEqual(rows[-1][0], "2025-12-31")
            self.assertGreaterEqual(lake["rainfallCells"], 400)
            self.assertEqual(len(lake["rainfallCellIds"]), lake["rainfallCells"])
            self.assertTrue(lake["waterSources"])
        self.assertEqual(len(report["sources"]), 65)


@unittest.skipUnless(
    importlib.util.find_spec("numpy"), "Optional scientific preparation dependency"
)
class LakeBenchmarkNumerics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import numpy as np

        spec = importlib.util.spec_from_file_location(
            "benchmark_lakes", ROOT / "scripts/benchmark_lakes.py"
        )
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)
        cls.np = np
        cls.report = json.loads((ROOT / "data/reference/lake-benchmark.json").read_text())

    def inputs(self, lake):
        rows = json.loads(
            gzip.decompress((ROOT / "data/reference" / lake["inputPath"]).read_bytes())
        )
        return (
            [date.fromisoformat(r[0]) for r in rows],
            self.np.array([r[1] if r[1] is not None else self.np.nan for r in rows]),
            self.np.array([r[2] if r[2] is not None else self.np.nan for r in rows]),
        )

    def test_real_inputs_reproduce_all_reported_metrics(self):
        for lake in self.report["lakes"]:
            actual = self.module.evaluate(*self.inputs(lake))
            for got, expected in zip(actual, lake["metrics"], strict=True):
                for key in expected:
                    self.np.testing.assert_allclose(got[key], expected[key], rtol=1e-9, atol=1e-9)

    def test_origin_rain_and_future_values_cannot_enter_origin_features(self):
        days, levels, rain = self.inputs(self.report["lakes"][0])
        origins, x = self.module.features(days, levels, rain)
        pos = int(self.np.flatnonzero(origins > 15000)[0])
        i = origins[pos]
        altered_rain, altered_levels = rain.copy(), levels.copy()
        altered_rain[i:] = 99999
        altered_levels[i + 1 :] = 99999
        oo, xx = self.module.features(days, altered_levels, altered_rain)
        self.np.testing.assert_array_equal(x[pos], xx[self.np.flatnonzero(oo == i)[0]])
        altered_levels[i - 2] = self.np.nan
        missing_origins, _ = self.module.features(days, altered_levels, rain)
        self.assertNotIn(i, missing_origins)

    def test_test_outcomes_do_not_tune_penalty_or_interval(self):
        days, levels, rain = self.inputs(self.report["lakes"][0])
        levels = levels.copy()
        levels[self.np.array([d.year >= 2016 for d in days])] += 2
        altered = self.module.evaluate(days, levels, rain)
        for got, original in zip(altered, self.report["lakes"][0]["metrics"], strict=True):
            self.assertEqual(got["penalty"], original["penalty"])
            self.assertAlmostEqual(got["intervalHalfWidthCm"], original["intervalHalfWidthCm"])


if __name__ == "__main__":
    unittest.main()
