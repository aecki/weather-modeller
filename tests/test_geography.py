"""Offline checks for bundled map integrity and projection/rendering conventions."""

import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class GeographyTests(unittest.TestCase):
    def test_bundled_assets_match_provenance_and_geographic_bounds(self):
        folder = ROOT / "web/geography"
        provenance = json.loads((folder / "provenance.json").read_text())
        self.assertEqual(provenance["attribution"], "© swisstopo")
        countries = None
        for output in provenance["outputs"]:
            raw = (folder / output["file"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), output["sha256"])
            data = json.loads(raw)
            self.assertEqual(data["type"], "FeatureCollection")
            self.assertEqual(len(data["features"]), output["features"])
            self.assertGreater(len(data["features"]), 0)
            if output["file"] == "countries.geojson":
                countries = data["features"]
            for feature in data["features"]:
                self.assertEqual(feature["geometry"]["type"], "MultiPolygon")
                for polygon in feature["geometry"]["coordinates"]:
                    for index, ring in enumerate(polygon):
                        self.assertEqual(ring[0], ring[-1])
                        for lon, lat in ring:
                            self.assertTrue(5.69999 <= lon <= 10.70001)
                            self.assertTrue(45.69999 <= lat <= 48.00001)
                        area = sum(
                            a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:], strict=False)
                        )
                        self.assertLess(area, 0) if index == 0 else self.assertGreater(area, 0)
        swiss = [f for f in countries if f["properties"]["countryCode"] == "CH"]
        self.assertEqual(len(swiss), 1)
        self.assertEqual(swiss[0]["properties"]["name"], "Switzerland")

    def test_known_swiss_station_is_inside_national_boundary(self):
        data = json.loads((ROOT / "web/geography/countries.geojson").read_text())
        swiss = next(f for f in data["features"] if f["properties"]["countryCode"] == "CH")

        def contains(ring, x, y):
            crossings = 0
            for a, b in zip(ring, ring[1:], strict=False):
                if (a[1] > y) != (b[1] > y):
                    crossings += x < a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            return crossings % 2 == 1

        for name, lon, lat in [("Bern", 7.46, 46.95), ("Lugano", 8.96, 46.00)]:
            with self.subTest(station=name):
                self.assertTrue(
                    any(
                        contains(p[0], lon, lat) and not any(contains(h, lon, lat) for h in p[1:])
                        for p in swiss["geometry"]["coordinates"]
                    )
                )

    def test_classic_map_integrity_and_projection(self):
        folder = ROOT / "web/geography"
        metadata = json.loads((folder / "classic-map.json").read_text())
        image = (folder / metadata["output"]["file"]).read_bytes()
        self.assertEqual(hashlib.sha256(image).hexdigest(), metadata["output"]["sha256"])
        self.assertEqual(metadata["attribution"], "© swisstopo")
        self.assertEqual(metadata["processing"]["sourceCRS"], "EPSG:2056")
        self.assertEqual(metadata["processing"]["imageCRS"], "EPSG:3857")
        self.assertEqual(metadata["processing"]["bounds"], [4.7, 45.2, 11.7, 48.3])
        self.assertEqual(metadata["processing"]["width"], 4000)
        self.assertEqual(image[:4], b"RIFF")
        self.assertEqual(image[8:12], b"WEBP")
