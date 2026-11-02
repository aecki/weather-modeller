"""Independent real-data checks of daily storm extraction and GPD/SMEV calculations.

Optional lmoments3/SciPy tooling; no Python packages are needed by the hosted models.
"""

import calendar
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
    raise SystemExit("Use the repository-local weather-modeller environment.")
import lmoments3
import numpy as np
from scipy import __version__ as scipy_version
from scipy.stats import genpareto, linregress, weibull_min

raw = (ROOT / "data/processed/observations.json").read_bytes()
data = json.loads(raw)
cases = []
for station in data["stations"]:
    for days in [1, 3, 5]:
        years = defaultdict(list)
        for date, value in zip(data["dates"], station["values"], strict=True):
            years[date[:4]].append(value)
        blocks = []
        for year, values in sorted(years.items()):
            if len(values) != (366 if calendar.isleap(int(year)) else 365) or any(
                v is None for v in values
            ):
                continue
            sums = {i: sum(values[i - days + 1 : i + 1]) for i in range(days - 1, len(values))}
            wet = [i for i, x in enumerate(values) if x >= 1]
            clusters = []
            for i in wet:
                if clusters and i - clusters[-1][-1] - 1 < days:
                    clusters[-1].append(i)
                else:
                    clusters.append([i])
            peaks = []
            for cluster in clusters:
                indices = range(
                    max(days - 1, cluster[0]), min(len(values) - 1, cluster[-1] + days - 1) + 1
                )
                end = max(indices, key=lambda i: sums[i])
                peak = (round(sums[end], 1), end - days + 1, end)
                while peaks and peak[1] <= peaks[-1][2]:
                    previous = peaks.pop()
                    if previous[0] >= peak[0]:
                        peak = previous
                peaks.append(peak)
            blocks.append(
                dict(year=year, maximum=round(max(sums.values()), 1), events=[p[0] for p in peaks])
            )
        train, test = blocks[:-10], blocks[-10:]
        events = np.sort([x for b in train for x in b["events"]])
        threshold = float(np.quantile(events, 0.9))
        excesses = events[events > threshold] - threshold
        l1, l2 = lmoments3.lmom_ratios(excesses, nmom=2)
        xi = 2 - l1 / l2
        gpd = dict(
            model="gpd",
            threshold=threshold,
            xi=xi,
            scale=l1 * (1 - xi),
            rate=len(excesses) / len(train),
        )
        p = np.arange(1, len(events) + 1) / (len(events) + 1)
        tail = p >= 0.8
        regression = linregress(np.log(events[tail]), np.log(-np.log1p(-p[tail])))
        smev = dict(
            model="smev",
            shape=float(regression.slope),
            scale=math.exp(-regression.intercept / regression.slope),
            rate=len(events) / len(train),
        )
        score_threshold = max(float(np.quantile([b["maximum"] for b in train], 0.8)), threshold)
        fits = []
        for fit in [gpd, smev]:

            def level(t, fit=fit, threshold=threshold):
                if fit["model"] == "gpd":
                    return float(
                        threshold
                        + genpareto.isf(
                            -math.log1p(-1 / t) / fit["rate"], fit["xi"], scale=fit["scale"]
                        )
                    )
                return float(
                    weibull_min.isf(
                        -math.expm1(math.log1p(-1 / t) / fit["rate"]),
                        fit["shape"],
                        scale=fit["scale"],
                    )
                )

            def probability(x, fit=fit, threshold=threshold):
                if fit["model"] == "gpd":
                    return float(
                        -np.expm1(
                            -fit["rate"]
                            * genpareto.sf(x - threshold, fit["xi"], scale=fit["scale"])
                        )
                    )
                return float(
                    -np.expm1(fit["rate"] * weibull_min.logcdf(x, fit["shape"], scale=fit["scale"]))
                )

            forecast = probability(score_threshold)
            target = level(10)
            heldout = np.array([b["maximum"] for b in test])
            fits.append(
                dict(
                    parameters=fit,
                    tailCount=int(len(excesses) if fit["model"] == "gpd" else tail.sum()),
                    levels=[dict(period=t, rainfall=level(t)) for t in [2, 10, 50, 100, 500]],
                    exceedances=[
                        dict(rainfall=x, probability=probability(x))
                        for x in [score_threshold, max(b["maximum"] for b in train)]
                    ],
                    brier=float(np.mean((forecast - (heldout > score_threshold)) ** 2)),
                    pinball=float(np.mean((heldout - target) * (0.9 - (heldout < target)))),
                )
            )
        cases.append(
            dict(
                station=station["id"],
                days=days,
                blocks=blocks,
                scoreThreshold=score_threshold,
                fits=fits,
            )
        )
output = dict(
    sourceSha256=hashlib.sha256(raw).hexdigest(),
    method="Independent calendar/storm extraction; lmoments3 sample L-moments; scipy.stats.linregress, genpareto, weibull_min",
    versions=dict(lmoments3=lmoments3.__version__, scipy=scipy_version, numpy=np.__version__),
    cases=cases,
)
(ROOT / "tests/fixtures/comparison-reference.json").write_text(
    json.dumps(output, separators=(",", ":"), allow_nan=False) + "\n"
)
print("Generated", len(cases), "real station/duration reference cases (108 new fits).")
