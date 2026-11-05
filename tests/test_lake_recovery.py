"""Causal weather inputs, snow mass balance, recovery censoring and real-data fits."""

import gzip
import hashlib
import importlib.util
import json
import unittest
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "data/reference/lake-recovery"


class RecoverySources(unittest.TestCase):
    def test_sources_are_versioned_and_cover_transboundary_catchments(self):
        inputs = json.loads((REFERENCE / "inputs.json").read_text())
        catchments = (REFERENCE / "catchments.json").read_bytes()
        self.assertEqual(hashlib.sha256(catchments).hexdigest(), inputs["catchmentsSha256"])
        for lake in inputs["lakes"]:
            raw = (REFERENCE / lake["history"]["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), lake["history"]["sha256"])
            rows = json.loads(gzip.decompress(raw))
            first = date.fromisoformat(rows[0][0])
            for i, row in enumerate(rows):
                self.assertEqual(row[0], str(first + timedelta(days=i)))
            self.assertAlmostEqual(sum(n["weight"] for n in lake["nodes"]), 1)
            self.assertTrue(lake["history"]["waterSources"])
            if lake["id"] == "2032":
                self.assertLess(lake["swissPercent"], 50)
                self.assertGreater(lake["areaKm2"], 10000)
        report = json.loads((REFERENCE / "validation.json").read_text())
        self.assertEqual(
            report["inputsSha256"],
            hashlib.sha256((REFERENCE / "inputs.json").read_bytes()).hexdigest(),
        )
        for lake in report["lakes"]:
            self.assertEqual(
                hashlib.sha256((REFERENCE / lake["modelPath"]).read_bytes()).hexdigest(),
                lake["modelSha256"],
            )
            for case in lake["cases"]:
                self.assertGreaterEqual(case["origin"], "2016-01-01")
                self.assertLessEqual(case["origin"], "2025-12-31")
                if case["observedRecoveryDays"] is not None:
                    self.assertGreaterEqual(case["observedRecoveryDays"], 7)
                    self.assertLessEqual(case["observedRecoveryDays"], case["observedFollowupDays"])
                if "archivedForecast" in case:
                    self.assertGreaterEqual(case["origin"], "2024-03-02")
                    self.assertIn("run=", case["archivedForecast"]["source"]["url"])


@unittest.skipUnless(importlib.util.find_spec("numpy"), "Optional pipeline dependency")
class RecoveryNumerics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import numpy as np

        from weather_modeller import lake_recovery as core
        from weather_modeller.lake_weather import hourly_days

        cls.np = np
        cls.core = core
        cls.hourly_days = staticmethod(hourly_days)
        cls.inputs = json.loads((REFERENCE / "inputs.json").read_text())

    def history(self, index=0):
        lake = self.inputs["lakes"][index]
        rows = json.loads(gzip.decompress((REFERENCE / lake["history"]["path"]).read_bytes()))
        return (
            lake,
            [date.fromisoformat(r[0]) for r in rows],
            self.np.array([r[1] if r[1] is not None else self.np.nan for r in rows]),
            self.np.array([r[2:] for r in rows], dtype=float),
        )

    def test_real_training_reproduces_frozen_models_and_ignores_test_targets(self):
        for index in (0, 1):
            lake, days, levels, weather = self.history(index)
            weights = self.np.array([n["weight"] for n in lake["nodes"]])
            model, *_ = self.core.train(days, levels, weather, weights)
            expected = json.loads((REFERENCE / f"model-{lake['id']}.json").read_text())
            self.np.testing.assert_allclose(model["beta"], expected["beta"], atol=1e-12)
            levels = levels.copy()
            weather = weather.copy()
            test = self.np.array([d.year >= 2016 for d in days])
            levels[test] += 100
            weather[test, :, 0] += 100
            changed, *_ = self.core.train(days, levels, weather, weights)
            self.assertEqual(changed, model)

    def test_real_archived_forecasts_reproduce_low_water_recovery_probabilities(self):
        report = json.loads((REFERENCE / "validation.json").read_text())
        for index, result in enumerate(report["lakes"]):
            lake, days, levels, weather = self.history(index)
            raw = (REFERENCE / result["baselinePath"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), result["baselineSha256"])
            bands = self.core.seasonal_bands(json.loads(gzip.decompress(raw)))
            self.np.testing.assert_array_equal(bands, result["historicalBands"])
            model = json.loads((REFERENCE / result["modelPath"]).read_text())
            weights = self.np.array([n["weight"] for n in lake["nodes"]])
            liquid, snow = self.core.snow_runoff(weather, weights)
            for case in result["cases"]:
                forecast = case.get("archivedForecast")
                if not forecast:
                    continue
                i = days.index(date.fromisoformat(case["origin"]))
                future = self.core.weather_paths(days, weather, i)
                future[:, : forecast["forecastDays"]] = self.np.asarray(forecast["weather"])
                paths = self.core.simulate(
                    model,
                    days[i],
                    levels[i - 7 : i + 1],
                    weather[i - 29 : i + 1],
                    snow[i],
                    liquid[i - 29 : i + 1],
                    future,
                    weights,
                )
                actual = self.core.summarize(paths, bands, days[i])["probabilities"]
                self.assertEqual(actual, forecast["probabilities"])

    def test_snow_partition_preserves_water_and_uses_no_future_temperature(self):
        # Isolated numerical fixture: these are not product observations.
        weather = self.np.array([[[10, -2, 0]], [[0, 1, 0]], [[0, 5, 0]]], dtype=float)
        water, stores = self.core.snow_runoff(weather, [1])
        self.np.testing.assert_allclose(water, [0, 3, 7])
        self.np.testing.assert_allclose(stores[:, 0], [10, 7, 0])
        self.assertEqual(sum(water) + stores[-1, 0], 10)
        changed = weather.copy()
        changed[-1, 0, 1] = -10
        early, _ = self.core.snow_runoff(changed, [1])
        self.np.testing.assert_array_equal(early[:2], water[:2])
        with self.assertRaises(ValueError):
            self.core.snow_runoff([[[None, 1, 0]]], [1])

    def test_recovery_requires_a_full_week_and_keeps_unrecovered_paths(self):
        # Isolated event fixture, including an overshoot above the seasonal upper bound.
        bands = [[1, 1.5, 2] for _ in range(366)]
        paths = self.np.array([[1.5] * 10, [0] * 10, [1.5] * 6 + [2.5] + [1.5] * 3])
        times = self.core.recovery_times(paths, bands, date(2022, 1, 1))
        self.assertEqual(times[0], 7)
        self.assertTrue(self.np.isinf(times[1:]).all())
        result = self.core.summarize(paths, bands, date(2022, 1, 1))
        self.assertIsNone(result["recoveryDays"][1])
        self.assertEqual(result["pathCount"], 3)

    def test_hourly_fluxes_respect_swiss_daylight_saving_and_missingness(self):
        for day, hours in [(date(2024, 3, 31), 23), (date(2024, 10, 27), 25)]:
            zone = ZoneInfo("Europe/Zurich")
            next_day = day + timedelta(days=1)
            start = datetime(day.year, day.month, day.day, tzinfo=zone).astimezone(UTC)
            end = datetime(next_day.year, next_day.month, next_day.day, tzinfo=zone).astimezone(UTC)
            timestamps = list(range(int(start.timestamp()) + 3600, int(end.timestamp()) + 1, 3600))
            self.assertEqual(len(timestamps), hours)
            # Isolated unit fixture, with hourly interval-end values.
            payload = dict(
                hourly_units=dict(
                    precipitation="mm", temperature_2m="°C", et0_fao_evapotranspiration="mm"
                ),
                hourly=dict(
                    time=timestamps,
                    precipitation=[1] * hours,
                    temperature_2m=[4] * hours,
                    et0_fao_evapotranspiration=[0] * hours,
                ),
            )
            days, values, _ = self.hourly_days(payload, day)
            self.assertEqual(days, [str(day)])
            self.assertEqual(values[0, 0, 0], hours)
            payload["hourly"]["precipitation"][-1] = None
            with self.assertRaises(ValueError):
                self.hourly_days(payload, day)

    def test_invalid_weather_member_is_excluded_across_all_catchment_nodes(self):
        from weather_modeller.lake_weather import valid_members

        first = date(2025, 6, 1)
        timestamp = int(datetime(2025, 6, 1, 12, tzinfo=UTC).timestamp())
        # Isolated input fixture: never exported as weather data.
        valid = dict(
            hourly=dict(
                time=[timestamp],
                precipitation=[0],
                et0_fao_evapotranspiration=[0],
                precipitation_member01=[1],
                et0_fao_evapotranspiration_member01=[0],
            )
        )
        bad = json.loads(json.dumps(valid))
        bad["hourly"]["precipitation_member01"][0] = -0.1
        accepted, rejected = valid_members([valid, bad], first)
        self.assertEqual(accepted, [""])
        self.assertEqual(rejected, ["_member01"])
        self.assertEqual(bad["hourly"]["precipitation_member01"][0], -0.1)

    def test_episode_starts_do_not_depend_on_future_recovery(self):
        days = [date(2022, 1, 1) + timedelta(days=i) for i in range(100)]
        bands = [[1, 1.5, 2] for _ in range(366)]
        levels = self.np.array([1.5] * 30 + [0] * 7 + [1.5] * 3 + [0] * 7 + [1.5] * 7 + [0] * 46)
        origins = self.core.low_water_origins(days, levels, bands)
        self.assertEqual(origins, [36, 60])
        changed = levels.copy()
        changed[70:] = 1.5
        self.assertEqual(origins, self.core.low_water_origins(days, changed, bands))

    def test_recursive_simulation_is_causal_and_reproducible(self):
        lake, days, levels, weather = self.history()
        model = json.loads((REFERENCE / "model-2209.json").read_text())
        weights = self.np.array([n["weight"] for n in lake["nodes"]])
        liquid, snow = self.core.snow_runoff(weather, weights)
        i = days.index(date(2022, 7, 1))
        future = self.core.weather_paths(days, weather, i, count=40)
        args = (
            model,
            days[i],
            levels[i - 7 : i + 1],
            weather[i - 29 : i + 1],
            snow[i],
            liquid[i - 29 : i + 1],
        )
        first = self.core.simulate(*args, future, weights)
        self.np.testing.assert_array_equal(first, self.core.simulate(*args, future, weights))
        altered = future.copy()
        altered[:, 14:, :, 0] += 25
        later = self.core.simulate(*args, altered, weights)
        self.np.testing.assert_array_equal(first[:, :14], later[:, :14])
        short = levels[i - 7 : i + 1].copy()
        short[0] = self.np.nan
        with self.assertRaises(ValueError):
            self.core.simulate(
                model,
                days[i],
                short,
                weather[i - 29 : i + 1],
                snow[i],
                liquid[i - 29 : i + 1],
                future,
                weights,
            )


if __name__ == "__main__":
    unittest.main()
