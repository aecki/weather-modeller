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

Map geography is bundled locally from the official Swiss Map Raster 500 download, with **© swisstopo** attribution. Exact source URLs, provider-verified archive checksums and derived image checksums are recorded in `web/geography/classic-map.json`. [swisstopo OGD conditions](https://www.swisstopo.admin.ch/en/conditions-geodata) allow free use with attribution. No remote map tiles or API are required. See the preparation details below.

## Model estimates are separate from observations

The Model lab now fits stationary GEV/Gumbel distributions to selected complete-year maxima and estimates return periods with bootstrap sampling uncertainty. These estimates do not change the observation snapshot or the descriptive historical rankings. Model assumptions, confidence-band interpretation and extrapolation limits are documented in [modelling.md](modelling.md).


### Classic topographic background

The default map background uses **Swiss Map Raster 500, colour combination (`komb`)**, © swisstopo, downloaded directly from the official STAC download service. It includes terrain relief, rivers and place names. The downloaded asset was last updated 31 December 2025; it is current cartographic context for every replay, not a historical-event map. A single bundled image replaces remote map tiles. The topographic map is the only view. Drag to pan; wheel, pinch, double-click and +/− buttons zoom (1–8×); arrow keys pan and Home resets. The camera is constrained to the bundled extent, preventing empty borders.

The source is a paletted 25-metre EPSG:2056 GeoTIFF representing a 1:500,000 map. `scripts/prepare_classic_map.py` checks its provider SHA256, expands the colour palette, reprojects with bilinear resampling to EPSG:3857 over 5.5–10.95° E and 45.5–48.0° N, and writes an 8,000-pixel-wide WebP (quality 85, method 6). The image is positioned using the same visx Mercator projection as the station markers, including zoom. This interior crop stays inside the official source image, excluding sheet-edge margins. Zoom enlarges a fixed-resolution image; it does not fetch more detailed maps. Rainfall marker colours remain unchanged.

`web/geography/classic-map.json` records exact source and metadata URLs, update time, input/output checksums and processing. This cartography supports geographic orientation; it is not an elevation analysis, catchment model or inundation map.

To regenerate, download the `komb` GeoTIFF from the STAC item linked in that JSON into `data/raw/geography/classic-map.tif`, and save the STAC item as `classic-map.json` in the same ignored directory. Install `requirements-geography.txt` inside the repository environment, then run `python scripts/prepare_classic_map.py`. Normal setup, build, serving and tests do not require these optional GIS/image preparation packages or raw downloads.

A 2,000-pixel overview loads initially; the bundled 8,000-pixel crop is requested from the same local origin only at 2× zoom and above. Both images have identical geographic bounds, so switching resolution preserves station alignment.

## Nationwide data investigation

The current production snapshot remains unchanged. The [full archive audit](rainfall-audit.md) covers 65 annual files, all listed Swiss address coordinates, and available preliminary/consolidated overlaps. It records revision and spatial-interpretation limits before any interface migration.
