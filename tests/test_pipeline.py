"""Offline tests for missingness, time boundaries, source formats and local assets."""

import json
import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.aggregation import mean_discharge_day, utc_datetime
from weather_modeller.catalog import date_range, load_catalog
from weather_modeller.ingestion import read_csv


class AggregationTests(unittest.TestCase):
    def setUp(self):
        start = datetime(2024, 6, 21, 6, tzinfo=UTC)
        self.rows = [
            {
                "timestamp": (start + timedelta(hours=i)).isoformat(),
                "value": float(i),
                "releaseState": "3",
            }
            for i in range(24)
        ]

    def test_mean_uses_exact_utc_window(self):
        extra = {"timestamp": "2024-06-22T06:00:00Z", "value": 99999, "releaseState": "1"}
        self.assertEqual(
            mean_discharge_day([extra, *reversed(self.rows)], "2024-06-21")["value"], 11.5
        )

    def test_missing_hour_does_not_become_zero(self):
        self.assertIsNone(mean_discharge_day(self.rows[:-1], "2024-06-21")["value"])

    def test_duplicate_hour_cannot_replace_missing_hour(self):
        self.assertIsNone(
            mean_discharge_day(self.rows[:-1] + [self.rows[0]], "2024-06-21")["value"]
        )

    def test_null_and_nonfinite_readings_are_missing(self):
        for value in (None, float("nan"), float("inf")):
            self.rows[0]["value"] = value
            self.assertIsNone(mean_discharge_day(self.rows, "2024-06-21")["value"])

    def test_zero_discharge_is_valid(self):
        for row in self.rows:
            row["value"] = 0
        self.assertEqual(mean_discharge_day(self.rows, "2024-06-21")["value"], 0)

    def test_mixed_release_states_are_preserved(self):
        self.rows[0]["releaseState"] = "1"
        self.assertEqual(mean_discharge_day(self.rows, "2024-06-21")["releaseState"], "1,3")

    def test_naive_timestamp_rejected(self):
        with self.assertRaises(ValueError):
            utc_datetime("2024-06-21T06:00:00")


class RepositoryTests(unittest.TestCase):
    def test_leap_day_and_reversed_range(self):
        self.assertEqual(
            date_range("2024-02-28", "2024-03-01"), ["2024-02-28", "2024-02-29", "2024-03-01"]
        )
        with self.assertRaises(ValueError):
            date_range("2024-03-01", "2024-02-28")

    def test_official_csv_encoding(self):
        rows = read_csv("name;rain\r\nZürich;\r\n".encode("cp1252"))
        self.assertEqual(rows, [{"name": "Zürich", "rain": ""}])

    def test_catalog_matches_snapshot(self):
        config = load_catalog(ROOT)
        snapshot = json.loads(
            (ROOT / "data/processed/observations.json").read_text(encoding="utf-8")
        )
        self.assertEqual(config["events"], snapshot["events"])
        self.assertEqual(config["weatherStations"], [s["id"] for s in snapshot["stations"]])
        self.assertEqual(config["riverStations"], [s["id"] for s in snapshot["rivers"]])

    def test_no_required_remote_runtime_assets(self):
        html = (ROOT / "web/index.html").read_text(encoding="utf-8")
        css = (ROOT / "web/style.css").read_text(encoding="utf-8")
        js = (ROOT / "web/app.js").read_text(encoding="utf-8")
        self.assertNotIn("@import", css)
        self.assertNotIn("L.tileLayer", js)
        self.assertNotRegex(html, r'(?:src|href)="https?://[^\"]+\.(?:js|css)')
        self.assertIn("connect-src 'self'", html)


if __name__ == "__main__":
    unittest.main()
