"""Daily weather-conditioned experimental recovery outlook for two Swiss lakes."""

import gzip
import hashlib
import json
import sys
import tempfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from weather_modeller.lake_recovery import (
    season,
    seasonal_bands,
    simulate,
    snow_runoff,
    summarize,
    weather_paths,
)
from weather_modeller.lake_weather import hourly_days, valid_members
from weather_modeller.regional import promote
from weather_modeller.sources import SourceClient
from weather_modeller.storage import write_json


def prepare(root=ROOT):
    reference = root / "data/reference/lake-recovery"
    inputs_raw = (reference / "inputs.json").read_bytes()
    inputs = json.loads(inputs_raw)
    validation_raw = (reference / "validation.json").read_bytes()
    validation = json.loads(validation_raw)
    if validation["inputsSha256"] != hashlib.sha256(inputs_raw).hexdigest():
        raise ValueError("Validation and reference versions differ")
    generated = datetime.now(UTC)
    client = SourceClient(root)
    results = []
    for lake in inputs["lakes"]:
        source_start = len(client.manifest)
        lake_id = lake["id"]
        water_raw = (root / f"data/processed/water/{lake_id}.json").read_bytes()
        water = json.loads(water_raw)
        analysis = water["analysis"]
        origin = date.fromisoformat(analysis["latest"])
        if (generated.date() - origin).days > 3:
            raise ValueError("Lake observation too old for a new outlook")
        report = next(item for item in validation["lakes"] if item["id"] == lake_id)
        model_raw = (reference / report["modelPath"]).read_bytes()
        if hashlib.sha256(model_raw).hexdigest() != report["modelSha256"]:
            raise ValueError("Model checksum mismatch")
        model = json.loads(model_raw)
        history_raw = (reference / lake["history"]["path"]).read_bytes()
        if hashlib.sha256(history_raw).hexdigest() != lake["history"]["sha256"]:
            raise ValueError("History checksum mismatch")
        history = json.loads(gzip.decompress(history_raw))
        history_days = [date.fromisoformat(r[0]) for r in history]
        history_weather = np.asarray([r[2:] for r in history], dtype=float)
        weights = np.array([n["weight"] for n in lake["nodes"]])
        # Use revised historical analyses only as initial-state context, never as forecasts.
        context_start = history_days[-1] + timedelta(days=1)
        if origin < context_start:
            raise ValueError("Daily outlook requires observations after the pinned history")
        params = dict(
            latitude=",".join(str(n["latitude"]) for n in lake["nodes"]),
            longitude=",".join(str(n["longitude"]) for n in lake["nodes"]),
            start_date=str(context_start),
            end_date=str(origin),
            daily="precipitation_sum,temperature_2m_mean,et0_fao_evapotranspiration",
            timezone="Europe/Zurich",
            models="ecmwf_ifs",
            cell_selection="nearest",
        )
        url = "https://historical-forecast-api.open-meteo.com/v1/forecast?" + urlencode(params)
        bridge = json.loads(client.fetch(url, f"lake-recovery/context-{lake_id}-{origin}.json"))
        if not isinstance(bridge, list) or len(bridge) != len(weights):
            raise ValueError("Initial weather context locations missing")
        if any(
            point["daily_units"].get("precipitation_sum") != "mm"
            or point["daily_units"].get("temperature_2m_mean") != "°C"
            or point["daily_units"].get("et0_fao_evapotranspiration") != "mm"
            for point in bridge
        ):
            raise ValueError("Unexpected daily weather units")
        bridge_days = bridge[0]["daily"]["time"]
        expected = [
            str(context_start + timedelta(days=i)) for i in range((origin - context_start).days + 1)
        ]
        if bridge_days != expected or any(d["daily"]["time"] != bridge_days for d in bridge):
            raise ValueError("Initial weather calendar incomplete")
        bridge_fields = np.array(
            [
                [
                    [
                        d["daily"][v][i]
                        for v in (
                            "precipitation_sum",
                            "temperature_2m_mean",
                            "et0_fao_evapotranspiration",
                        )
                    ]
                    for d in bridge
                ]
                for i in range(len(bridge_days))
            ],
            dtype=float,
        )
        liquid, snow = snow_runoff(bridge_fields, weights, model["initialSnow2025"])
        # One response for all catchment nodes preserves ensemble member alignment.
        params = dict(
            latitude=",".join(str(n["latitude"]) for n in lake["nodes"]),
            longitude=",".join(str(n["longitude"]) for n in lake["nodes"]),
            hourly="precipitation,temperature_2m,et0_fao_evapotranspiration",
            models="ecmwf_ifs025",
            forecast_days=16,
            past_days=3,
            timeformat="unixtime",
            timezone="UTC",
            cell_selection="nearest",
        )
        url = "https://ensemble-api.open-meteo.com/v1/ensemble?" + urlencode(params)
        stamp = generated.strftime("%Y%m%dT%H")
        ensemble = json.loads(client.fetch(url, f"lake-recovery/ensemble-{lake_id}-{stamp}.json"))
        if not isinstance(ensemble, list) or len(ensemble) != len(weights):
            raise ValueError("Forecast locations missing")
        all_members = sorted(
            k.removeprefix("precipitation")
            for k in ensemble[0]["hourly"]
            if k == "precipitation" or k.startswith("precipitation_member")
        )
        accepted, rejected = valid_members(ensemble, origin + timedelta(days=1), limit=15)
        if len(accepted) < 20:
            raise ValueError(
                "Too few valid ensemble members after rejecting negative weather fluxes"
            )
        decoded = [
            hourly_days(
                d, origin + timedelta(days=1), ensemble=True, selected_members=accepted, limit=15
            )
            for d in ensemble
        ]
        members = decoded[0][2]
        if any(d[2] != members for d in decoded):
            raise ValueError("Forecast member mismatch across catchment")
        horizon = min(len(d[0]) for d in decoded)
        if horizon < 7:
            raise ValueError("Less than seven complete weather forecast days")
        weather_forecast = np.stack([d[1][:horizon] for d in decoded], axis=2).transpose(1, 0, 2, 3)
        # Seasonal weather after the forecast is explicitly a scenario assumption.
        future = weather_paths(
            history_days, history_weather, 0, count=len(members) * 10, origin_day=origin
        )
        for i in range(len(future)):
            future[i, :horizon] = weather_forecast[i % len(members)]
        lookup = {r[0]: r[1] for r in water["rows"]}
        prior_levels = [lookup.get(str(origin - timedelta(days=i))) for i in range(7, -1, -1)]
        if any(v is None for v in prior_levels):
            raise ValueError("Initial lake level history incomplete")
        paths = simulate(
            model,
            origin,
            prior_levels,
            bridge_fields[-30:],
            snow[-1],
            liquid[-30:],
            future,
            weights,
        )
        bands = seasonal_bands(water["rows"], 1991, 2020)
        summary = summarize(paths, bands, origin)
        latest_band = bands[(date(2000, origin.month, origin.day) - date(2000, 1, 1)).days]
        outside_training = (
            analysis["level"] < model["featureMin"][0] or analysis["level"] > model["featureMax"][0]
        )
        output = dict(
            schemaVersion=1,
            id=lake_id,
            generatedAt=generated.isoformat(),
            observationDate=str(origin),
            level=analysis["level"],
            observationSha256=hashlib.sha256(water_raw).hexdigest(),
            modelSha256=report["modelSha256"],
            validationSha256=hashlib.sha256(validation_raw).hexdigest(),
            catchment={k: lake[k] for k in ("basinId", "areaKm2", "swissPercent", "nodes")},
            forecastStart=str(origin + timedelta(days=1)),
            forecastThrough=str(origin + timedelta(days=horizon)),
            forecastDays=horizon,
            weatherMembers=len(members),
            sourceWeatherMembers=len(all_members),
            excludedWeatherMembers=rejected,
            exclusionReason="Negative hourly precipitation/ET0 or missing variable; same member excluded at every catchment node. No flux values are clipped or filled.",
            sources=client.manifest[source_start:].copy(),
            state="below"
            if analysis["level"] < latest_band[0]
            else "above"
            if analysis["level"] > latest_band[2]
            else "within",
            outsideTrainingRange=outside_training,
            seasonalBaseline="1991–2020, calendar day ±15 days, middle 50%; recovery requires seven consecutive in-range daily means.",
            summary=summary,
            targetBands=[
                [
                    bands[season(origin + timedelta(days=h))][0],
                    bands[season(origin + timedelta(days=h))][2],
                ]
                for h in range(91)
            ],
            validation=report,
            limits=[
                "Experimental weather-conditioned outlook, not an official hydrological forecast.",
                f"Weather: ECMWF IFS 0.25-degree ensemble via Open-Meteo; {len(members)} of {len(all_members)} members retained. Returned data do not pin a forecast run; source retrieval time and response checksum are retained.",
                "After the last complete weather-forecast day, use whole seasonal historical ERA5 weather blocks from before 2016. These later days are conditional scenarios, not long-range weather forecasts.",
                "Four area-weighted weather nodes per full topographic catchment; coarse spatial and elevation sampling.",
                "Conceptual snowmelt and statistical lake response; no observed snowpack, inflow gauges, lake evaporation or planned outlet operations. Zurich regulation is represented only indirectly by past levels and seasonality.",
                "Bands combine weather members, resampled fitted parameters and seven-day residual blocks. They omit some structural error and are not guaranteed to have 90% coverage.",
                "Archived forecast tests use deterministic 9-km ECMWF IFS, not the current ensemble. Ensemble recovery probabilities are not independently calibrated.",
            ],
        )
        results.append(output)
        print(
            lake_id,
            "weather days",
            horizon,
            "members",
            len(members),
            "recovery",
            summary["recoveryDays"],
            summary["probabilities"],
            flush=True,
        )
    cache = root / ".cache/lake-outlook-build"
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache) as directory:
        staged = Path(directory) / "lake-outlook"
        staged.mkdir()
        entries = []
        for result in results:
            raw = (json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n").encode()
            sha = hashlib.sha256(raw).hexdigest()
            name = f"{result['id']}-{sha}.json"
            (staged / name).write_bytes(raw)
            entries.append(dict(id=result["id"], path=name, sha256=sha))
        write_json(
            staged / "manifest.json",
            dict(schemaVersion=1, generatedAt=generated.isoformat(), lakes=entries),
        )
        promote(staged, root / "data/processed/lake-outlook")


if __name__ == "__main__":
    if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
        raise SystemExit("Use the repository environment")
    prepare()
