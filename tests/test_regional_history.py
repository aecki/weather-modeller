"""Historical summaries preserve real threshold counts and incomplete-month exclusion."""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.regional_history import gzip_bytes, monthly_counts, validate_history


@unittest.skipUnless(
    importlib.util.find_spec("numpy"), "optional regional dependencies not installed"
)
class HistoricalCountTests(unittest.TestCase):
    def test_counts_against_independent_real_rasterio_reference(self):
        import numpy as np

        fixture = json.loads((ROOT / "tests/fixtures/regional-history/reference.json").read_text())
        for values in fixture["observations"]:
            counts = monthly_counts(
                np.array(values, dtype="f4")[:, None], np.array(fixture["thresholds"], dtype="f4")
            )
            self.assertEqual(int(counts[0, 0]), 30)
            for level, count in zip(fixture["thresholds"], counts[:, 0], strict=True):
                self.assertEqual(int(count), sum(v >= level for v in values))

    def test_incomplete_month_is_excluded_not_partially_counted(self):
        import numpy as np

        # Isolated completeness/corruption fixtures, never application inputs.
        data = np.array([[0.0, 1.0], [2.0, np.nan], [3.0, 4.0]])
        counts = monthly_counts(data, [0, 1, 3])
        np.testing.assert_array_equal(counts[:, 0], [3, 2, 1])
        np.testing.assert_array_equal(counts[:, 1], [0, 0, 0])
        with self.assertRaisesRegex(ValueError, "Negative"):
            monthly_counts(np.array([[-1.0]]), [0, 1])

    def test_pinned_manifest_rejects_modified_metadata(self):
        cache = ROOT / ".cache/tmp"
        cache.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=cache) as directory:
            path = Path(directory)
            (path / "manifest.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "manifest checksum mismatch"):
                validate_history(path, "0" * 64)

    def test_gzip_is_reproducible(self):
        self.assertEqual(gzip_bytes(b"isolated gzip fixture"), gzip_bytes(b"isolated gzip fixture"))
