"""Offline tests for missingness, time boundaries, source formats and local assets."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.aggregation import mean_discharge_day, utc_datetime
from weather_modeller.ingestion import date_range, load_catalog, read_csv


class AggregationTests(unittest.TestCase):
    def setUp(self):
        start = datetime(2024, 6, 21, 6, tzinfo=timezone.utc)
        self.rows = [{"timestamp": (start + timedelta(hours=i)).isoformat(), "value": float(i), "releaseState": "3"} for i in range(24)]

    def test_mean_uses_exact_utc_window(self):
        extra = {"timestamp": "2024-06-22T06:00:00Z", "value": 99999, "releaseState": "1"}
        self.assertEqual(mean_discharge_day([extra, *reversed(self.rows)], "2024-06-21")["value"], 11.5)

    def test_missing_hour_does_not_become_zero(self):
        self.assertIsNone(mean_discharge_day(self.rows[:-1], "2024-06-21")["value"])

    def test_duplicate_hour_cannot_replace_missing_hour(self):
        self.assertIsNone(mean_discharge_day(self.rows[:-1] + [self.rows[0]], "2024-06-21")["value"])

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
        self.assertEqual(date_range("2024-02-28", "2024-03-01"), ["2024-02-28", "2024-02-29", "2024-03-01"])
        with self.assertRaises(ValueError):
            date_range("2024-03-01", "2024-02-28")

    def test_official_csv_encoding(self):
        rows = read_csv('name;rain\r\nZürich;\r\n'.encode("cp1252"))
        self.assertEqual(rows, [{"name": "Zürich", "rain": ""}])

    def test_catalog_matches_snapshot(self):
        config = load_catalog(ROOT)
        snapshot = json.loads((ROOT / "data/processed/observations.json").read_text(encoding="utf-8"))
        self.assertEqual(config["events"], snapshot["events"])
        self.assertEqual(config["weatherStations"], [s["id"] for s in snapshot["stations"]])
        self.assertEqual(config["riverStations"], [s["id"] for s in snapshot["rivers"]])

    def test_no_required_remote_runtime_assets(self):
        html = (ROOT / "web/index.html").read_text(encoding="utf-8")
        css = (ROOT / "web/style.css").read_text(encoding="utf-8")
        js = (ROOT / "web/app.js").read_text(encoding="utf-8")
        self.assertNotIn('@import', css)
        self.assertNotIn('L.tileLayer', js)
        self.assertNotRegex(html, r'(?:src|href)="https?://[^\"]+\.(?:js|css)')
        self.assertIn("connect-src 'self'", html)

class ExportTests(unittest.TestCase):
    def test_export_uses_observations_and_preserves_missing_values(self):
        from weather_modeller.exports import selection_csv
        snapshot = {"dates": ["2024-01-01", "2024-01-02", "2024-01-03"],
                    "events": [{"id": "e", "start": "2024-01-01", "end": "2024-01-03"}],
                    "stations": [{"id": "s", "values": [0, None, 5]}],
                    "rivers": [{"id": "r", "river": "Test", "events": {"e": []}}]}
        filename, content = selection_csv(snapshot, {"event": "e", "station": "s", "river": "r", "days": 3})
        self.assertEqual(filename, "swiss-observations-e-s-r-3day.csv")
        import csv, io
        rows = list(csv.DictReader(io.StringIO(content)))
        self.assertEqual(rows[0]["rain_daily_mm"], "0")
        self.assertEqual(rows[1]["rain_daily_mm"], "")
        self.assertEqual(rows[2]["rain_trailing_3day_mm"], "")
        with self.assertRaises(ValueError):
            selection_csv(snapshot, {"event": "../../bad", "station": "s", "river": "r", "days": 3})

class LocalServerTests(unittest.TestCase):
    def test_exports_stay_in_repository_and_reject_cross_origin(self):
        from functools import partial
        from http.server import ThreadingHTTPServer
        import tempfile, threading, urllib.request, urllib.error
        from weather_modeller.cli import LocalAppHandler
        cache = ROOT / ".cache" / "tmp"
        cache.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=cache) as temporary:
            root = Path(temporary)
            (root / "data/processed").mkdir(parents=True)
            (root / "data/processed/observations.json").write_bytes((ROOT / "data/processed/observations.json").read_bytes())
            server = ThreadingHTTPServer(("127.0.0.1", 0), partial(LocalAppHandler, root=root))
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            url = f"http://127.0.0.1:{server.server_port}"
            selection = json.dumps({"event": "2005", "station": "MER", "river": "2135", "days": 3}).encode()
            try:
                request = urllib.request.Request(url + "/api/exports", data=selection, headers={"Content-Type": "application/json", "Origin": url})
                result = json.load(urllib.request.urlopen(request))
                self.assertTrue((root / result["path"]).is_file())
                self.assertEqual(Path(result["path"]).parent.as_posix(), "outputs")
                request = urllib.request.Request(url + "/api/exports", data=selection, headers={"Content-Type": "application/json", "Origin": "https://example.com"})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, 403)
            finally:
                server.shutdown()
                server.server_close()
                worker.join()


if __name__ == "__main__":
    unittest.main()
