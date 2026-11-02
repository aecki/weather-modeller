"""Offline checks for bundled map integrity and projection/rendering conventions."""

import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class GeographyTests(unittest.TestCase):
    def test_classic_map_integrity_and_projection(self):
        folder = ROOT / "web/geography"
        metadata = json.loads((folder / "classic-map.json").read_text())
        image = (folder / metadata["output"]["file"]).read_bytes()
        self.assertEqual(hashlib.sha256(image).hexdigest(), metadata["output"]["sha256"])
        self.assertEqual(metadata["attribution"], "© swisstopo")
        self.assertEqual(metadata["processing"]["sourceCRS"], "EPSG:2056")
        self.assertEqual(metadata["processing"]["imageCRS"], "EPSG:3857")
        self.assertEqual(metadata["processing"]["bounds"], [5.5, 45.5, 10.95, 48.0])
        self.assertEqual(metadata["processing"]["width"], 8000)
        overview = (folder / metadata["overview"]["file"]).read_bytes()
        self.assertEqual(hashlib.sha256(overview).hexdigest(), metadata["overview"]["sha256"])
        self.assertEqual(image[:4], b"RIFF")
        self.assertEqual(image[8:12], b"WEBP")
