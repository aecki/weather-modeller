"""Current-year aggregation preserves complete months, zeroes and missing cells."""

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "prepare_year_overview", ROOT / "scripts/prepare_year_overview.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@unittest.skipUnless(importlib.util.find_spec("numpy"), "Optional data preparation dependency")
class YearOverviewTests(unittest.TestCase):
    def test_complete_month_cells_remain_distinct_from_missing_and_zero(self):
        import numpy as np

        result = module.sum_complete_month([[0, 1, np.nan], [0, 2, 3]])
        self.assertEqual(float(result[0]), 0)
        self.assertEqual(float(result[1]), 3)
        self.assertTrue(np.isnan(result[2]))
        with self.assertRaises(ValueError):
            module.sum_complete_month([[0, -1]])
        with self.assertRaises(ValueError):
            module.sum_complete_month([[np.inf]])


if __name__ == "__main__":
    unittest.main()
