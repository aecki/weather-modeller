# Observation methodology

## Sources

Source: MeteoSwiss, [SwissMetNet automatic weather stations](https://opendatadocs.meteoswiss.ch/a-data-groundbased/a1-automatic-weather-stations). Historical per-station daily CSV files, parameter `rre150d0`, millimetres. MeteoSwiss CSVs use Windows-1252 encoding, semicolon delimiters and UTC reference timestamps. Empty fields are missing observations. Original station series are not homogenised climate trend records.

Source: Federal Office for the Environment FOEN, [Hydrological observations](https://data.bafu.admin.ch/en/dataproduct-water-observations), GraphQL `data_1hour_mean`, parameter Q. The API documents timestamps as interval starts. Original hourly observations, native units and release flags remain in the processed snapshot. Flags: 1 provisional, 2 validated, 3 final/replaced. No state filtering is applied.

Both sources require attribution; see [MeteoSwiss terms](https://opendatadocs.meteoswiss.ch/) and [FOEN licence](https://data.bafu.admin.ch/en/lizenz-und-quelle). This selected network is not comprehensive Swiss coverage. Event windows are editorial selections for exploration; the data values are official observations.

## Time windows

A MeteoSwiss rainfall day labelled D runs from 06:00 UTC on D to 06:00 UTC on D+1, following the provider's daily precipitation convention. The date is not a midnight-to-midnight calendar day.

The explorer calculates river means over matching 06:00–06:00 UTC windows from 24 hourly means. The 24 timestamps must be distinct and exactly match the expected hours; missing/duplicate hours, nulls and nonfinite values make the derived daily value null. This is an arithmetic mean of hourly means, not an instantaneous peak or the provider's own daily aggregate. This avoids silently assuming that FOEN daily timestamps share MeteoSwiss daily boundaries.

Rainfall and river stations are selected independently. Their proximity does not imply a catchment match or a causal relationship. River circles are not shown as rainfall measurements.

## Rainfall calculations

- 1/3/5-day rainfall totals are trailing sums ending on the cursor date.
- They can include days before the replay begins, using the full historical series.
- Missing values never become zero; a sum requires every daily observation.
- An event peak is the largest complete window ending within that replay period.
- Event replay periods have different lengths; comparisons are descriptive, not frequency estimates.
- Annual maxima require a complete calendar year's daily records and multi-day windows wholly within that year.
- Historical counts are counts among complete-year maxima, not fitted return periods or future probabilities.

Map circles show station measurements, not spatial rainfall footprints or flood-inundation zones. The sample cannot resolve every local convective event.

## Provenance and refresh

`config/catalog.json` defines stations, dates and replay windows. `python run.py fetch` downloads missing responses and reuses cached responses only when the URL and request body match. `--refresh` forces fresh downloads. Cached originals and request metadata live under `data/raw/`. Each source's exact URL/body, retrieval time and SHA256 are written to `data/processed/provenance.json`.

The processed JSON includes original hourly river records so derived values can be verified without a network connection. The complete snapshot is prepared before output replacement; a failed download does not fabricate values. Refreshing is a deliberate action and may update historical observations when providers revise records.

## Geography

Country boundaries use Natural Earth 1:50m; lakes use 1:10m. Selected features are bundled locally, with input URLs and hashes in `web/geography/provenance.json`. Boundaries are generalised for display, not cadastral or hydrological analysis. Natural Earth data is public domain.

## Model estimates are separate from observations

The Model lab now fits stationary GEV/Gumbel distributions to selected complete-year maxima and estimates return periods with bootstrap sampling uncertainty. These estimates do not change the observation snapshot or the descriptive historical rankings. Model assumptions, confidence-band interpretation and extrapolation limits are documented in [modelling.md](modelling.md).
