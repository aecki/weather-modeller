"""Regression tests for builds, atomic writes, schema validation, and source caching."""

import copy
import json
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.build import REQUIRED_ASSETS, build
from weather_modeller.sources import SourceClient
from weather_modeller.storage import atomic_write_bytes
from weather_modeller.validation import validate_snapshot


class LocalTemporaryTest(unittest.TestCase):
    def setUp(self):
        cache = ROOT / ".cache/tmp"
        cache.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=cache)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)


class StorageTests(LocalTemporaryTest):
    def test_failed_replace_preserves_existing_file_and_cleans_temporary_file(self):
        path = self.root / "export.csv"
        path.write_bytes(b"previous complete export")
        with patch("weather_modeller.storage.Path.replace", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                atomic_write_bytes(path, b"new export")
        self.assertEqual(path.read_bytes(), b"previous complete export")
        self.assertEqual(list(self.root.iterdir()), [path])

    def test_concurrent_exports_never_interleave_bytes(self):
        path = self.root / "export.csv"
        payloads = [str(i).encode() * 10000 for i in range(8)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda content: atomic_write_bytes(path, content), payloads))
        self.assertIn(path.read_bytes(), payloads)
        self.assertEqual(list(self.root.iterdir()), [path])

    def test_windows_sharing_violation_is_avoided_for_parallel_exports(self):
        import time
        from threading import Lock

        windows_handle = Lock()
        original = Path.replace

        def windows_replace(source, destination):
            if not windows_handle.acquire(blocking=False):
                raise PermissionError("WinError 5: overlapping destination handle")
            try:
                time.sleep(0.005)
                return original(source, destination)
            finally:
                windows_handle.release()

        path = self.root / "export.csv"
        payloads = [str(index).encode() * 1000 for index in range(8)]
        with (
            patch("weather_modeller.storage.Path.replace", windows_replace),
            ThreadPoolExecutor(max_workers=4) as pool,
        ):
            list(pool.map(lambda content: atomic_write_bytes(path, content), payloads))
        self.assertIn(path.read_bytes(), payloads)


class BuildTests(LocalTemporaryTest):
    def setUp(self):
        super().setUp()
        compiler = patch("weather_modeller.build.compile_frontend")
        compiler.start()
        self.addCleanup(compiler.stop)
        data = self.root / "data/processed"
        data.mkdir(parents=True)
        for filename in ("observations.json", "provenance.json"):
            (data / filename).write_bytes((ROOT / "data/processed" / filename).read_bytes())
        for asset in REQUIRED_ASSETS:
            if asset.startswith("data/"):
                continue
            path = self.root / "web" / asset
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture", encoding="utf-8")
        (self.root / "dist").mkdir()
        (self.root / "dist/previous.txt").write_text("working app", encoding="utf-8")

    def test_incomplete_build_preserves_previous_app(self):
        (self.root / "web/app.js").unlink()
        with self.assertRaisesRegex(ValueError, "Missing application asset"):
            build(self.root)
        self.assertEqual((self.root / "dist/previous.txt").read_text(), "working app")

    def test_successful_build_replaces_old_files(self):
        build(self.root)
        self.assertFalse((self.root / "dist/previous.txt").exists())
        self.assertTrue((self.root / "dist/data/observations.json").is_file())
        self.assertTrue((self.root / "dist/.nojekyll").is_file())
        self.assertEqual(list((self.root / ".cache/build").iterdir()), [])

    def test_failed_promotion_restores_previous_app(self):
        original = Path.rename

        def fail_staged(path, target):
            if path.name == "dist" and path.parent != self.root:
                raise OSError("simulated promotion failure")
            return original(path, target)

        with patch("weather_modeller.build.Path.rename", fail_staged):
            with self.assertRaises(OSError):
                build(self.root)
        self.assertEqual((self.root / "dist/previous.txt").read_text(), "working app")


class SnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = json.loads(
            (ROOT / "data/processed/observations.json").read_text(encoding="utf-8")
        )

    def test_real_snapshot_passes(self):
        validate_snapshot(self.snapshot)

    def test_invalid_date_or_rainfall_rejected(self):
        for value in (-1, True, float("nan"), float("inf"), "5"):
            snapshot = copy.deepcopy(self.snapshot)
            snapshot["stations"][0]["values"][0] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_snapshot(snapshot)
        snapshot = copy.deepcopy(self.snapshot)
        snapshot["dates"][1] = snapshot["dates"][0]
        with self.assertRaises(ValueError):
            validate_snapshot(snapshot)


class SourceCacheTests(LocalTemporaryTest):
    def test_cache_matches_both_url_and_request(self):
        client = SourceClient(self.root)
        response = CompletedProcess([], 0, stdout=b"official-response")
        with patch("weather_modeller.sources.subprocess.run", return_value=response) as download:
            self.assertEqual(
                client.fetch("https://example.test/source", "source.json", {"query": "first"}),
                b"official-response",
            )
            client.fetch("https://example.test/source", "source.json", {"query": "first"})
            self.assertEqual(download.call_count, 1)
            client.fetch("https://example.test/source", "source.json", {"query": "changed"})
            self.assertEqual(download.call_count, 2)
            client.fetch("https://example.test/other", "source.json", {"query": "changed"})
            self.assertEqual(download.call_count, 3)


if __name__ == "__main__":
    unittest.main()
