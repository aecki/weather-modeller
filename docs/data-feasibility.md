# Nationwide daily precipitation: feasibility review

Checked 3 November 2026. Scope: investigate data before changing the interface. Product intent is online only; a reproducible repository development environment remains useful. No interface, production data snapshot or model was changed.

Follow-up: [full archive and national address audit](rainfall-audit.md), completed 3 November 2026.

## Decision

**Proceed with nationwide address search and observation-based regional precipitation estimates. Do not promise measured rainfall or calibrated extreme-event probabilities at each building.** Keep nearby station observations and their models separately identifiable. Address precision is the precision of the lookup, not of the rainfall estimate.

A suitable default headline is “How much precipitation fell around your location, and how unusual was it?” Use “Latest available day” when yesterday is not yet published. These datasets include snowfall water equivalent; calling all winter precipitation “rain” is inaccurate.

## Sources and scientific limits

- [RprelimD documentation](https://www.meteoswiss.admin.ch/dam/jcr:86ca15d3-2b56-4753-84fb-135e40d6a5a1/ProdDoc_RprelimD.pdf): preliminary daily precipitation, superseded by RhiresD. The recommended interpretation is regional, over a roughly 20×20 to 30×30 km neighbourhood. Sparse observations and early quality checks limit local extremes. Its older documentation says availability at 10:00 the next day, without specifying a timezone; do not turn this into a promised publication time.
- [RhiresD documentation](https://www.meteoswiss.admin.ch/dam/jcr:4f51f0f1-0fe3-48b5-9de0-15666327e63c/ProdDoc_RhiresD.pdf): longer-term daily analysis, 1961 onward. Effective resolution is approximately 15–20 km despite kilometre grid spacing. Interpolation smooths intense precipitation. This product is unsuitable for interpreting building-scale extreme statistics. Network changes also limit trend interpretation. Both products use precipitation days 06:00 UTC on D to 06:00 UTC on D+1, not local calendar days.
- [Current grid delivery documentation](https://opendatadocs.meteoswiss.ch/c-climate-data/c3-ground-based-climate-data): daily preliminary items, consolidated monthly files and annual archives are separate. Documented preliminary retention is 41 days; monthly retention is 14 months, with revisions and annual reprocessing. Attribute “Source: MeteoSwiss”.
- [swisstopo address search](https://docs.geo.admin.ch/access-data/search.html): supports address/place queries and geographic coordinates. The user must choose a result; search ordering does not establish an exact match.
- [Radar products](https://opendatadocs.meteoswiss.ch/d-radar-data/d1-precipitation-radar-products): CombiPrecip combines radar and gauges; hourly analyses are revised after eight days. Public access is a rolling 14-day window; archive access requires a request. It is a future candidate for recent spatial detail, not an already verified multi-decade baseline. Do not compare CPC amounts directly to RhiresD return levels without cross-product validation. If deriving daily CPC totals, select non-overlapping hourly accumulations, not the overlapping rolling totals published every five minutes.

## Actual file and service checks

The machine-readable [evidence](data-feasibility-evidence.json) records URLs, hashes, sample results and limitations. Downloads remain under ignored `data/raw/feasibility/`; no packages were installed. Existing repository NumPy/rasterio decoded the NetCDF/HDF5 files. Provider SHA-256 multihashes matched all four downloaded files.

| Check | Observed result |
|---|---|
| Live catalogue | 78 items, no next-page link at this request |
| Annual RhiresD inventory | 65 yearly assets labelled 1961–2025; inventory checked, not all files decoded |
| Latest preliminary asset at 09:43 UTC | 1 November 2026; published 2 November around 12:16 UTC; 2 November not yet present |
| Preliminary inventory | 59 date items, 4 September–1 November; longer than documented retention, not a retention guarantee |
| Latest daily download | 1,211,647 bytes; 265×370 cells; 1,000 m spacing; EPSG:2056 |
| Latest daily mask | 63,185 valid cells and 34,865 missing cells across the rectangular hydrological domain |
| 2025 annual download | 143,995,038 bytes; 365 daily layers, same grid; no negative valid amounts |
| Geographic spot checks | Valid values at eight returned place coordinates: Basel, Genève, Lugano, Davos Clavadel, Zermatt, Juf, Meiringen, Schaffhausen |
| Public building address | Search returned Bundesplatz 3, 3011 Bern with coordinates, plus other candidates |
| Revision spot check | 25 September 2026 preliminary vs consolidated: 63,185 paired cells; mean absolute change 0.00062 mm, maximum 0.093 mm |

The revision example has small differences and does not bound revisions on wet/extreme days. Place coverage does not prove every address is valid. The domain includes foreign catchments: its valid-cell count is not a count of Swiss cells. Check the Swiss boundary and the individual cell mask separately; never convert a masked value to zero or snap across missing cells silently. The “Davos” query returned Davos Clavadel, illustrating why selection confirmation matters.

For the 2025 station check, transform each existing station coordinate to LV95, select its containing grid cell, and align all 365 calendar-date labels with the app's daily station observations. Each of the 18 stations had 365 paired values. Selected annual maxima (not necessarily on the same day):

| Station | Station maximum (mm) | Grid-cell maximum (mm) |
|---|---:|---:|
| Meiringen | 59.3 | 49.51 |
| Säntis | 64.9 | 46.89 |
| Lugano | 117.8 | 97.13 |
| Locarno / Monti | 156.9 | 137.35 |

These are source-consistency diagnostics. The stations contribute to the analysis, so this is not independent accuracy validation, a correction factor, or evidence for the quality of unobserved locations. Grid time coordinates are midnight date labels; product documentation, not the timestamp alone, defines accumulation boundaries.

## What the product can say

| Claim | Recommendation |
|---|---|
| Estimated precipitation around a searched address | Yes, explicitly regional and preliminary where applicable; show period and source |
| Precipitation measured at that building | No, unless there is an identified gauge there |
| Historical rank for the surrounding area | Conditional: compare the same grid product/location/period, disclose recent-vs-final status |
| Unusual for the season | Feasible after fixing reference years, seasonal window, wet/all-day denominator and handling of zero ties |
| Nearby station measurement and fitted probability | Yes, using sufficient valid history; show station name, distance and elevation difference; probability refers to the station |
| Regional gridded return levels | Pro Mode research candidate after validation; never label them building-level risk |
| Chance of flooding, damage or rain tomorrow | Not supplied by this precipitation-hazard analysis |

Overview should first use observed historical counts/ranks, with record length. Keep “fraction of comparable days” separate from “annual chance of at least one exceedance”. For annual modelling, use complete years and the existing uncertainty/support guards. Sampling intervals do not cover interpolation, preliminary-data revisions, model choice or climate change.

Do not fit a baseline by silently concatenating preliminary and final products. Prefer final historical years for fitting; compare a preliminary selected amount with an explicit status and investigate cross-product differences before offering a probability headline. Regional aggregation is a candidate to test, not a guaranteed fix for representativeness.

## Operational and storage feasibility

A daily job is practical: discover STAC assets, record provider checksums/versions, validate grids/masks/time conventions, and publish atomically. Poll after the observed midday UTC publication, retry later, and always show freshness; one sample does not establish a service-level guarantee. Re-fetch revised monthly/annual assets by changed checksum, retaining the identity of the source used for each result.

The measured 2025 file is 144 MB. Multiplying that representative size by 65 gives roughly 9.4 GB compressed; this is an estimate, not a measured archive total. Raw float32 storage for that grid across approximately 65 years is about 9.3 GB before masks/coordinates/overhead. Do not put the archive into Git history or send it all to each browser.

Keep GitHub Pages for the interface. Prepare location-oriented time-series chunks and summary maps in external data storage; benchmark chunk requests before deciding whether a query service is necessary. Browser workers can retain the existing modelling engine. Address searches go to swisstopo; avoid retaining user search text in application logs.

## Gates before the interface implementation

1. Decode all annual assets and test expected dates, leap years, masks, units and versions. Audit the newest monthly/daily data for gaps.
2. Check a representative national address sample against the Swiss boundary and grid mask, including alpine/border areas. This will quantify geographic availability, not rainfall accuracy.
3. Compare multiple wet/extreme days with stations and compare preliminary vs final products across seasons. Use independent withheld gauges where obtainable; otherwise state the dependence. Do not infer national accuracy from the current small sample.
4. Fix and test the historical comparison definition; separately validate any regional extreme estimates with held-out complete years and spatial checks.
5. Benchmark a small location-chunk prototype: initial archive preparation cost, daily revision processing, payload size and browser refitting time.

**Recommended first release scope:** address-selected regional daily estimates, transparent historical context and a nearby-station analysis. Preserve all four models in Pro Mode. Withhold building-scale return-period claims. No UI or architecture migration is authorized by this review alone; review these findings first.
