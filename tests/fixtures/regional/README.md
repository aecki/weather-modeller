# Real regional-data references

Source: MeteoSwiss RprelimD, rainfall day 16 September 2026. Original URLs and provider/source checksums are in `reference.json`.

The NetCDF fixture is derived from that official file: it preserves all precipitation values, masks, coordinates and required attributes while omitting redundant lon/lat arrays and applying lossless compression. It is a test input, never application data. The original raw download remains ignored in `data/raw/`.

The independent little-endian float32 reference was exported with Rasterio 1.4.3 / NumPy 2.5.4. Rows run north to south; only masked source values become NaN. Tests compare the production netCDF4 decoder byte for byte against this independent result and inspect real missing, zero and nonzero values.

Address response: © swisstopo, public address search for Bundesplatz 3 Bern. The captured response demonstrates SearchServer’s northing/easting order, including in its GeoJSON coordinates. No personal address input is used.
