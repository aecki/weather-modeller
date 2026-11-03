"""Entry-page cache consistency across static deployments."""

import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.build import version_entry_assets


class AssetVersionTests(unittest.TestCase):
    def test_versions_match_content_and_change_on_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            names = ("style.css", "overview.css", "graphics.js", "data-core.js", "app.js")
            original = "\n".join(f'<script src="{name}"></script>' for name in names)
            for name in names:
                (path / name).write_text(name)
            (path / "index.html").write_text(original)
            version_entry_assets(path)
            first = (path / "index.html").read_text()
            for name in names:
                digest = hashlib.sha256(name.encode()).hexdigest()[:16]
                self.assertIn(f"{name}?v={digest}", first)
            (path / "app.js").write_text("revised")
            (path / "index.html").write_text(original)
            version_entry_assets(path)
            second = (path / "index.html").read_text()
            self.assertNotEqual(first, second)
            self.assertEqual(first.splitlines()[:3], second.splitlines()[:3])
