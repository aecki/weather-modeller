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

Map geography: **© swisstopo**. The Swiss national boundary comes from swissBOUNDARIES3D (January 2026); neighbouring country polygons and lakes come from swissTLMRegio 2026. These are geographic display layers, not rainfall observations or model outputs. Current geography is used for all historical events.

The bundled GeoJSON is derived from official LV95/EPSG:2056 shapefiles, simplified with a topology-preserving 100-metre tolerance, transformed to WGS84 longitude/latitude, and clipped to 5.7–10.7° E, 45.7–48.0° N. Lakes smaller than 0.5 km² are omitted at this national display scale. Polygon exteriors are clockwise for d3/visx spherical rendering. These generalised boundaries must not be used for cadastral or hydrological analysis.

Exact download URLs, archive SHA256 hashes (verified against the provider's STAC checksums), processing parameters and output hashes are recorded in `web/geography/provenance.json`. [swisstopo OGD conditions](https://www.swisstopo.admin.ch/en/conditions-geodata) allow free use with attribution. The map displays © swisstopo and links to the source record. No remote tiles, map API or runtime downloads are used.

To regenerate explicitly, download the two archives and their STAC item JSON metadata listed in the provenance into `data/raw/geography/`, named by version (`swisstlmregio_2026.zip`/`.json`, `swissboundaries3d_2026-01.zip`/`.json`). In the repository environment, install optional tools with `python -m pip --isolated install --no-user --cache-dir .cache/pip -r requirements-geography.txt`, then run `python scripts/prepare_geography.py`. The script verifies archive checksums before processing. These tools and the ignored source downloads are not required for normal setup, build, tests or serving.

## Model estimates are separate from observations

The Model lab now fits stationary GEV/Gumbel distributions to selected complete-year maxima and estimates return periods with bootstrap sampling uncertainty. These estimates do not change the observation snapshot or the descriptive historical rankings. Model assumptions, confidence-band interpretation and extrapolation limits are documented in [modelling.md](modelling.md).


### Classic topographic background

The default map background uses **Swiss Map Raster 500, colour combination (`komb`)**, © swisstopo, downloaded directly from the official STAC download service. It includes terrain relief, rivers and place names. The downloaded asset was last updated 31 December 2025; it is current cartographic context for every replay, not a historical-event map. A single bundled image replaces remote map tiles. Turning off “Topographic map” restores the bundled boundary/lake view.

The source is a paletted 25-metre EPSG:2056 GeoTIFF representing a 1:500,000 map. `scripts/prepare_classic_map.py` checks its provider SHA256, expands the colour palette, reprojects with bilinear resampling to EPSG:3857 over 4.7–11.7° E and 45.2–48.3° N, and writes a 4,000-pixel-wide WebP (quality 85, method 6). The image is positioned using the same visx Mercator projection as the station markers, including zoom. Areas outside the source map are white. Zoom enlarges a fixed-resolution image; it does not fetch more detailed maps. Rainfall marker colours remain unchanged.

`web/geography/classic-map.json` records exact source and metadata URLs, update time, input/output checksums and processing. This cartography supports geographic orientation; it is not an elevation analysis, catchment model or inundation map.

To regenerate, download the `komb` GeoTIFF from the STAC item linked in that JSON into `data/raw/geography/classic-map.tif`, and save the STAC item as `classic-map.json` in the same ignored directory. Install `requirements-geography.txt` inside the repository environment, then run `python scripts/prepare_classic_map.py`. Normal setup, build, serving and tests do not require these optional GIS/image preparation packages or raw downloads.
