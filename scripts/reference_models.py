#!/usr/bin/env python3
"""Regenerate independent model references from the actual bundled observations.

Optional requirements-science.txt is needed only for this development command.
"""

import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if Path(sys.prefix).resolve() != (ROOT / ".environments/weather-modeller").resolve():
    raise SystemExit("Activate the repository-local weather-modeller environment first.")
import lmoments3
import numpy
import scipy
from lmoments3 import distr
from scipy.stats import genextreme, gumbel_r

path = ROOT / "data/processed/observations.json"
snapshot = json.loads(path.read_text(encoding="utf-8"))
years = defaultdict(list)
for index, day in enumerate(snapshot["dates"]):
    years[day[:4]].append(index)
cases = []
periods = [2, 10, 50, 100, 500]
for station in snapshot["stations"]:
    for duration in [1, 3, 5]:
        maxima = []
        for year, indices in years.items():
            if any(station["values"][index] is None for index in indices):
                continue
            windows = [
                sum(station["values"][index - duration + 1 : index + 1])
                for index in indices[duration - 1 :]
            ]
            maxima.append({"year": year, "value": round(max(windows), 1)})
        values = [row["value"] for row in maxima]
        for name, distribution in [("gev", distr.gev), ("gumbel", distr.gum)]:
            fit = distribution.lmom_fit(values)
            frozen = genextreme(**fit) if name == "gev" else gumbel_r(**fit)
            xi = -fit.get("c", 0)
            support = all(1 + xi * (value - fit["loc"]) / fit["scale"] > 0 for value in values)
            cases.append(
                {
                    "station": station["id"],
                    "days": duration,
                    "model": name,
                    "maxima": maxima,
                    "fit": {"location": fit["loc"], "scale": fit["scale"], "xi": xi},
                    "supportValid": support,
                    "levels": [
                        {"period": period, "rainfall": float(frozen.isf(1 / period))}
                        for period in periods
                    ],
                    "exceedances": [
                        {"rainfall": value, "probability": float(frozen.sf(value))}
                        for value in [min(values), max(values), 2 * max(values)]
                    ],
                }
            )
output = {
    "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    "method": "lmoments3 L-moment fit, SciPy inverse survival and survival functions",
    "versions": {
        "lmoments3": lmoments3.__version__,
        "scipy": scipy.__version__,
        "numpy": numpy.__version__,
    },
    "cases": cases,
}
(ROOT / "tests/fixtures/extreme-reference.json").write_text(
    json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8"
)
print(
    f"Generated {len(cases)} independent real-data reference cases; {sum(not case['supportValid'] for case in cases)} have out-of-support fitted observations."
)
