"""Initial reference publication must distinguish missing data from API failure."""

import hashlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "regional_reference_release", ROOT / "scripts/regional_reference_release.py"
)
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


class ReferencePublicationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / ".cache/tmp")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "config").mkdir()
        self.config = {
            "repository": "aecki/weather-modeller",
            "releaseTag": "data-regional-models-fixture",
            "assetName": "regional-models.tar.gz",
            "referenceId": "fixture",
        }
        self.save_config()
        env = patch.dict(
            os.environ,
            {
                "GH_TOKEN": "isolated-test-fixture",
                "GITHUB_OUTPUT": str(self.root / "output"),
                "GITHUB_ENV": str(self.root / "env"),
            },
        )
        env.start()
        self.addCleanup(env.stop)

    def save_config(self):
        (self.root / "config/regional-models.json").write_text(json.dumps(self.config))

    def test_existing_release_requires_the_named_asset(self):
        for assets, expected in [([], "false"), ([{"name": "regional-models.tar.gz"}], "true")]:
            with patch.object(
                publication.urllib.request,
                "urlopen",
                return_value=io.BytesIO(json.dumps({"assets": assets}).encode()),
            ):
                publication.inspect(self.root)
            self.assertIn(f"exists={expected}", (self.root / "output").read_text().splitlines()[-1])

    def test_only_404_triggers_initial_preparation(self):
        missing = urllib.error.HTTPError("https://api.github.com", 404, "missing", {}, None)
        with patch.object(publication.urllib.request, "urlopen", side_effect=missing):
            publication.inspect(self.root)
        self.assertIn("exists=false", (self.root / "output").read_text())
        forbidden = urllib.error.HTTPError("https://api.github.com", 403, "forbidden", {}, None)
        with patch.object(publication.urllib.request, "urlopen", side_effect=forbidden):
            with self.assertRaises(urllib.error.HTTPError):
                publication.inspect(self.root)

    def test_publication_checks_archive_manifest_and_reference_identity(self):
        archive = self.root / "outputs/regional-models.tar.gz"
        manifest = self.root / "data/processed/regional-models/manifest.json"
        archive.parent.mkdir(parents=True)
        manifest.parent.mkdir(parents=True)
        archive.write_bytes(b"isolated archive checksum fixture")
        manifest.write_text(json.dumps({"referenceId": "fixture"}))
        self.config.update(
            archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
            manifestSha256=hashlib.sha256(manifest.read_bytes()).hexdigest(),
        )
        self.save_config()
        publication.verify(self.root)
        archive.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            publication.verify(self.root)
