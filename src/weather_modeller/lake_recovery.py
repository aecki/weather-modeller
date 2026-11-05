"""Catchment-weather lake trajectories and censored recovery-event diagnostics.

Optional NumPy is used only during data preparation, never in the hosted browser.
"""

from datetime import date, timedelta

import numpy as np


def season(day):
    return (date(2000, day.month, day.day) - date(2000, 1, 1)).days


def seasonal_bands(rows, first=1970, last=2009):
    observations = [
        (date.fromisoformat(r[0]), r[1])
        for r in rows
        if first <= int(r[0][:4]) <= last and r[1] is not None
    ]
    result = []
    for s in range(366):
        values = [
            (d.year, v)
            for d, v in observations
            if min(abs(season(d) - s), 366 - abs(season(d) - s)) <= 15
        ]
        result.append(
            np.quantile([v for _, v in values], [0.25, 0.5, 0.75]).tolist()
            if len({y for y, _ in values}) >= 20
            else None
        )
    return result


def snow_runoff(weather, weights, initial=None):
    """Fixed 0 C partition and 3 mm/C/day conceptual melt, not observed snowpack."""
    weather = np.asarray(weather, dtype=float)
    if weather.ndim != 3 or weather.shape[2] != 3 or not np.isfinite(weather).all():
        raise ValueError("Incomplete catchment precipitation/temperature/ET0")
    if (weather[:, :, 0] < 0).any() or (weather[:, :, 2] < 0).any():
        raise ValueError("Negative precipitation or ET0")
    snow = np.zeros(len(weights)) if initial is None else np.asarray(initial).copy()
    liquid, stores = [], []
    for fields in weather:
        p, t, _ = fields.T
        snowfall = np.where(t < 0, p, 0)
        snow += snowfall
        melt = np.minimum(snow, 3 * np.maximum(t, 0))
        snow -= melt
        liquid.append(float(np.dot(p - snowfall + melt, weights)))
        stores.append(snow.copy())
    return np.asarray(liquid), np.asarray(stores)


def vector(day, previous, liquid, rain, et0, temp):
    phase = season(day) * 2 * np.pi / 366
    return np.array(
        [
            previous[-1],
            previous[-1] - previous[-2],
            previous[-1] - previous[-8],
            liquid[-1],
            np.mean(liquid[-7:]),
            np.mean(rain[-30:]),
            et0,
            temp,
            np.sin(phase),
            np.cos(phase),
        ]
    )


def fit(x, y, penalty):
    mean, scale = x.mean(axis=0), x.std(axis=0)
    scale[scale < 1e-10] = 1
    z = np.column_stack([np.ones(len(x)), (x - mean) / scale])
    regularizer = np.eye(z.shape[1]) * penalty
    regularizer[0, 0] = 0
    beta = np.linalg.solve(z.T @ z + regularizer, z.T @ y)
    return dict(mean=mean.tolist(), scale=scale.tolist(), beta=beta.tolist())


def predict(model, x):
    return np.column_stack([np.ones(len(x)), (x - model["mean"]) / model["scale"]]) @ model["beta"]


def design(days, levels, weather, weights):
    liquid, snow = snow_runoff(weather, weights)
    rain = weather[:, :, 0] @ weights
    temperature = weather[:, :, 1] @ weights
    et0 = weather[:, :, 2] @ weights
    positions, features, targets = [], [], []
    for i in range(366, len(days)):
        if np.isfinite(levels[i - 8 : i + 1]).all():
            positions.append(i)
            features.append(
                vector(
                    days[i],
                    levels[i - 8 : i],
                    liquid[i - 29 : i + 1],
                    rain[i - 29 : i + 1],
                    et0[i],
                    temperature[i],
                )
            )
            targets.append(levels[i] - levels[i - 1])
    return np.asarray(positions), np.asarray(features), np.asarray(targets), liquid, snow


def train(days, levels, weather, weights):
    ii, x, y, liquid, snow = design(days, levels, weather, weights)
    years = np.array([days[i].year for i in ii])
    training, validation = years <= 2009, (years >= 2010) & (years <= 2015)
    if training.sum() < 3650 or validation.sum() < 365:
        raise ValueError("Insufficient continuous training and validation data")
    choices = []
    for penalty in (1, 10, 100, 1000):
        model = fit(x[training], y[training], penalty)
        error = y[validation] - predict(model, x[validation])
        choices.append((float(np.mean(error**2)), penalty, error))
    _, penalty, errors = min(choices, key=lambda row: row[0])
    # Seven-day blocks must contain consecutive validation dates, never bridge gaps.
    vi = ii[validation]
    blocks = [errors[j : j + 7].tolist() for j in range(len(errors) - 6) if vi[j + 6] - vi[j] == 6]
    final = years <= 2015
    model = fit(x[final], y[final], penalty)
    rng = np.random.default_rng(4271)
    unique = np.unique(years[final])
    boot = []
    for _ in range(60):
        chosen = rng.choice(unique, len(unique), replace=True)
        selection = np.concatenate([np.flatnonzero(years == year) for year in chosen])
        boot.append(fit(x[selection], y[selection], penalty))
    model.update(
        penalty=penalty,
        bootstrap=boot,
        residualBlocks=blocks,
        trainingThrough="2015-12-31",
        featureMin=x[final].min(axis=0).tolist(),
        featureMax=x[final].max(axis=0).tolist(),
    )
    return model, liquid, snow


def weather_paths(
    days, weather, origin, horizon=90, count=400, last_year=2015, seed=1103, origin_day=None
):
    """Whole observed/reanalysed seasonal weather blocks; no future target weather."""
    candidates = []
    target = season((days[origin] if origin_day is None else origin_day) + timedelta(days=1))
    for i, d in enumerate(days):
        if i + horizon > len(days) or days[i + horizon - 1].year > last_year or d.year < 1990:
            continue
        distance = abs(season(d) - target)
        if min(distance, 366 - distance) <= 15:
            candidates.append(i)
    if len(candidates) < 20:
        raise ValueError("Too few complete seasonal weather blocks")
    rng = np.random.default_rng(seed)
    chosen = rng.choice(candidates, count)
    return np.stack([weather[i : i + horizon] for i in chosen])


def simulate(
    model,
    start,
    previous_levels,
    previous_weather,
    initial_snow,
    previous_liquid,
    future,
    weights,
    seed=1729,
):
    """Recursive daily level paths with parameter and seven-day residual uncertainty."""
    future = np.asarray(future, dtype=float)
    if future.ndim != 4 or not np.isfinite(future).all() or not np.isfinite(previous_levels).all():
        raise ValueError("Missing forecast inputs")
    count, horizon, nodes, _ = future.shape
    if len(previous_levels) < 8 or len(previous_weather) < 30:
        raise ValueError("Insufficient initial context")
    if (future[:, :, :, 0] < 0).any() or (future[:, :, :, 2] < 0).any():
        raise ValueError("Invalid future weather")
    weights = np.asarray(weights)
    rng = np.random.default_rng(seed)
    models = [model["bootstrap"][i] for i in rng.integers(0, len(model["bootstrap"]), count)]
    mean = np.array([m["mean"] for m in models])
    scale = np.array([m["scale"] for m in models])
    beta = np.array([m["beta"] for m in models])
    blocks = np.asarray(model["residualBlocks"])
    noise = blocks[rng.integers(0, len(blocks), (count, (horizon + 6) // 7))].reshape(count, -1)[
        :, :horizon
    ]
    # Remove validation-period mean error once; keep the model's fitted mean change.
    noise -= blocks.mean()
    levels = np.repeat(np.asarray(previous_levels[-8:])[None, :], count, axis=0)
    snow = np.repeat(np.asarray(initial_snow)[None, :], count, axis=0)
    liquid = np.repeat(np.asarray(previous_liquid)[-30:][None, :], count, axis=0)
    rain = np.repeat(
        (np.asarray(previous_weather)[:, :, 0] @ weights)[-30:][None, :], count, axis=0
    )
    output = []
    for h in range(horizon):
        fields = future[:, h]
        p, t, e = fields[:, :, 0], fields[:, :, 1], fields[:, :, 2]
        snowfall = np.where(t < 0, p, 0)
        snow += snowfall
        melt = np.minimum(snow, 3 * np.maximum(t, 0))
        snow -= melt
        water = (p - snowfall + melt) @ weights
        liquid = np.column_stack([liquid[:, 1:], water])
        rain = np.column_stack([rain[:, 1:], p @ weights])
        day = start + timedelta(days=h + 1)
        phase = season(day) * 2 * np.pi / 366
        x = np.column_stack(
            [
                levels[:, -1],
                levels[:, -1] - levels[:, -2],
                levels[:, -1] - levels[:, -8],
                water,
                liquid[:, -7:].mean(axis=1),
                rain.mean(axis=1),
                e @ weights,
                t @ weights,
                np.full(count, np.sin(phase)),
                np.full(count, np.cos(phase)),
            ]
        )
        change = beta[:, 0] + np.sum(((x - mean) / scale) * beta[:, 1:], axis=1) + noise[:, h]
        next_level = levels[:, -1] + change
        levels = np.column_stack([levels[:, 1:], next_level])
        output.append(next_level)
    paths = np.asarray(output).T
    if not np.isfinite(paths).all():
        raise ValueError("Unstable lake trajectories")
    return paths


def recovery_times(paths, bands, start):
    """First completion of seven consecutive in-band days; unrecovered remain infinity."""
    paths = np.asarray(paths, dtype=float)
    result = np.full(len(paths), np.inf)
    streak = np.zeros(len(paths), dtype=int)
    for i in range(paths.shape[1]):
        band = bands[season(start + timedelta(days=i + 1))]
        if band is None:
            raise ValueError("Seasonal band unavailable")
        inside = (paths[:, i] >= band[0]) & (paths[:, i] <= band[2])
        streak = np.where(inside, streak + 1, 0)
        result = np.where((streak >= 7) & ~np.isfinite(result), i + 1, result)
    return result


def summarize(paths, bands, start):
    times = recovery_times(paths, bands, start)
    # The inverse empirical CDF preserves non-recovery as infinity, never discards it.
    quantiles = np.quantile(times, [0.1, 0.5, 0.9], method="inverted_cdf")
    return dict(
        probabilities=[
            dict(days=h, probability=float(np.mean(times <= h)))
            for h in (14, 30, 60, 90)
            if h <= paths.shape[1]
        ],
        recoveryDays=[int(v) if np.isfinite(v) else None for v in quantiles],
        trajectory=np.quantile(paths, [0.05, 0.5, 0.95], axis=0).T.tolist(),
        pathCount=len(paths),
    )


def low_water_origins(days, levels, bands, first=2016, last=2025):
    """Causal episode starts; require seven non-low days before starting a new episode."""
    streak, non_low = 0, 0
    emitted = False
    origins = []
    for i, day in enumerate(days):
        band = bands[season(day)]
        valid = band is not None and np.isfinite(levels[i])
        below = valid and levels[i] < band[0]
        if below:
            streak += 1
            non_low = 0
        elif valid:
            streak = 0
            non_low += 1
            if non_low >= 7:
                emitted = False
        else:
            streak, non_low = 0, 0
        if streak >= 7 and not emitted:
            emitted = True
            if first <= day.year <= last and i >= 30:
                origins.append(i)
    return origins
