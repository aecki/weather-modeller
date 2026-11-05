"""Explicit retrospective lake benchmark; never produces an operational forecast.

Requires local verified annual rain archive and prepared FOEN lake observations.
"""

import gzip
import hashlib
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def features(days, levels, rain):
    """Origin-date information only; rain D-1 ends at 06 UTC on origin D."""
    rows, origins = [], []
    for i in range(30, len(days)):
        if not np.isfinite(levels[i - 7 : i + 1]).all():
            continue
        prior = rain[i - 30 : i]
        if not np.isfinite(prior).all():
            continue
        phase = (days[i] - date(days[i].year, 1, 1)).days * 2 * np.pi / 365.2425
        rows.append(
            [
                levels[i],
                levels[i] - levels[i - 1],
                levels[i] - levels[i - 7],
                sum(prior[-3:]),
                sum(prior[-7:]),
                sum(prior),
                np.sin(phase),
                np.cos(phase),
            ]
        )
        origins.append(i)
    return np.asarray(origins), np.asarray(rows)


def fit(x, y, penalty):
    mean, scale = x.mean(axis=0), x.std(axis=0)
    scale[scale == 0] = 1
    z = np.column_stack([np.ones(len(x)), (x - mean) / scale])
    regularizer = np.eye(z.shape[1]) * penalty
    regularizer[0, 0] = 0
    beta = np.linalg.solve(z.T @ z + regularizer, z.T @ y)
    return mean, scale, beta


def predict(model, x):
    mean, scale, beta = model
    return np.column_stack([np.ones(len(x)), (x - mean) / scale]) @ beta


def evaluate(days, levels, rain):
    origins, x = features(days, levels, rain)
    metrics = []
    for horizon in (7, 14, 28):
        eligible = origins + horizon < len(days)
        ii, xx = origins[eligible], x[eligible]
        # Continuous daily observations are required throughout the target window.
        valid = np.asarray([np.isfinite(levels[i : i + horizon + 1]).all() for i in ii])
        ii, xx = ii[valid], xx[valid]
        yy = levels[ii + horizon] - levels[ii]
        end_year = np.asarray([days[i + horizon].year for i in ii])
        origin_year = np.asarray([days[i].year for i in ii])
        train = end_year <= 2009
        validation = (origin_year >= 2010) & (end_year <= 2015)
        test = (origin_year >= 2016) & (end_year <= 2025)
        if min(train.sum(), validation.sum(), test.sum()) < 365:
            raise ValueError("Insufficient complete benchmark observations")
        candidates = []
        for penalty in (1, 10, 100, 1000):
            model = fit(xx[train], yy[train], penalty)
            residual = yy[validation] - predict(model, xx[validation])
            candidates.append((np.mean(np.abs(residual)), penalty, residual))
        _, penalty, calibration = min(candidates, key=lambda v: v[0])
        # Validation residuals only: no test outcomes used to choose uncertainty width.
        radius = float(np.quantile(np.abs(calibration), 0.9))
        model = fit(xx[end_year <= 2015], yy[end_year <= 2015], penalty)
        error = yy[test] - predict(model, xx[test])
        baseline = np.abs(yy[test])
        no_rain = [0, 1, 2, 6, 7]
        candidate_no_rain = min(
            (
                np.mean(
                    np.abs(
                        yy[validation]
                        - predict(
                            fit(xx[train][:, no_rain], yy[train], p), xx[validation][:, no_rain]
                        )
                    )
                ),
                p,
            )
            for p in (1, 10, 100, 1000)
        )[1]
        no_rain_model = fit(
            xx[end_year <= 2015][:, no_rain], yy[end_year <= 2015], candidate_no_rain
        )
        no_rain_error = yy[test] - predict(no_rain_model, xx[test][:, no_rain])
        # Paired whole-year resampling respects overlapping daily forecast errors.
        blocks = [np.flatnonzero(origin_year[test] == y) for y in range(2016, 2026)]
        rng = np.random.default_rng(9200 + horizon)
        improvement = []
        for _ in range(2000):
            indices = np.concatenate([blocks[j] for j in rng.integers(0, 10, 10)])
            improvement.append(float(np.mean(baseline[indices] - np.abs(error[indices])) * 100))
        metrics.append(
            dict(
                horizonDays=horizon,
                testOrigins=int(test.sum()),
                penalty=penalty,
                maeCm=float(np.mean(np.abs(error)) * 100),
                persistenceMaeCm=float(np.mean(baseline) * 100),
                withoutRainMaeCm=float(np.mean(np.abs(no_rain_error)) * 100),
                rmseCm=float(np.sqrt(np.mean(error**2)) * 100),
                nominalCoverage=0.9,
                actualCoverage=float(np.mean(np.abs(error) <= radius)),
                intervalHalfWidthCm=radius * 100,
                improvementIntervalCm=np.quantile(improvement, [0.025, 0.975]).tolist(),
            )
        )
    return metrics


def main():
    import h5py

    if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
        raise SystemExit("Use the repository environment")
    manifest = json.loads((ROOT / "data/processed/regional-history/manifest.json").read_text())
    grid = manifest["grid"]
    cells = np.fromfile(ROOT / "data/processed/regional-history/cells.u32", dtype="<u4")
    masks, lakes, precipitation = {}, {}, {}
    for lake_id in ("2209", "2032"):
        lake = json.loads((ROOT / f"data/processed/water/{lake_id}.json").read_text())
        lakes[lake_id] = lake
        station = lake["station"]
        east = grid["west"] + (cells % grid["width"] + 0.5) * 1000
        north = grid["north"] - (cells // grid["width"] + 0.5) * 1000
        masks[lake_id] = cells[
            (abs(east - station["localX"]) <= 20000) & (abs(north - station["localY"]) <= 20000)
        ]
        precipitation[lake_id] = []
    sources = []
    for source in manifest["sources"]:
        path = ROOT / f"data/raw/rainfall-audit/{source['year']}.nc"
        if hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError("Archive checksum mismatch")
        with h5py.File(path) as f:
            a = f["RhiresD"][:]
            if f["N"][0] < f["N"][-1]:
                a = a[:, ::-1]
            if f["E"][0] > f["E"][-1]:
                a = a[:, :, ::-1]
            a = a.reshape(len(a), -1)
            fill = float(f["RhiresD"].attrs["_FillValue"][0])
            for lake_id, mask in masks.items():
                values = a[:, mask].astype(float)
                complete = np.all((values != fill) & np.isfinite(values) & (values >= 0), axis=1)
                mean = values.mean(axis=1)
                mean[~complete] = np.nan
                precipitation[lake_id].extend(mean.tolist())
        sources.append(source)
        print("Rainfall", source["year"], flush=True)
    days = [date(1961, 1, 1) + timedelta(days=i) for i in range(len(precipitation["2209"]))]
    results = []
    for lake_id, lake in lakes.items():
        lookup = {d: v for d, v, *_ in lake["rows"]}
        levels = np.array([lookup.get(str(d), np.nan) for d in days])
        input_rows = [
            [str(d), float(h) if np.isfinite(h) else None, float(r) if np.isfinite(r) else None]
            for d, h, r in zip(days, levels, precipitation[lake_id], strict=True)
        ]
        input_raw = gzip.compress(json.dumps(input_rows, separators=(",", ":")).encode(), mtime=0)
        input_name = f"lake-benchmark-{lake_id}.json.gz"
        (ROOT / "data/reference" / input_name).write_bytes(input_raw)
        metrics = evaluate(days, levels, np.asarray(precipitation[lake_id]))
        results.append(
            dict(
                id=lake_id,
                name=lake["station"]["riverName"],
                rainfallCells=len(masks[lake_id]),
                waterSha256=hashlib.sha256(
                    (ROOT / f"data/processed/water/{lake_id}.json").read_bytes()
                ).hexdigest(),
                inputPath=input_name,
                inputSha256=hashlib.sha256(input_raw).hexdigest(),
                rainfallCellIds=masks[lake_id].tolist(),
                waterSources=lake["sources"],
                metrics=metrics,
            )
        )
        print(lake_id, metrics, flush=True)
    output = ROOT / "data/reference/lake-benchmark.json"
    output.write_text(
        json.dumps(
            dict(
                schemaVersion=1,
                training="1970–2009",
                tuning="2010–2015",
                testing="2016–2025",
                method="Direct ridge regression of lake-level change; previous levels, 1/7-day trends, preceding 3/7/30-day rainfall and annual sine/cosine.",
                rainfall="Swiss-mask cells within 20 km east/west and north/south of each gauge. A regional rainfall indicator, not a catchment mean. Rainfall is lagged by one label day.",
                limits="Retrospective final-data benchmark; no future weather, snowmelt, evaporation, inflows or outlet-operation inputs. Daily test origins overlap. No operational forecast or recovery date. Intervals calibrated on 2010–2015 residuals, not guaranteed future coverage.",
                sources=sources,
                lakes=results,
            ),
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
