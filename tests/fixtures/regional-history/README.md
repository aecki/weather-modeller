# Independent historical comparison reference

Source: MeteoSwiss RhiresD annual archives, 1961–2025. The public Bundesplatz 3 Bern coordinate falls in row 124 / column 126 of the LV95 grid.

`reference.json` contains 65 real November records extracted independently with Rasterio 1.4.3 window reads, original source hashes, a fixed NumPy 2.5.4 year-resample index matrix, and expected frequency bounds/percentile intervals. Query amounts are test analysis thresholds, not invented weather observations. The production reference is generated with netCDF4; every stored threshold count for this cell was checked against the independent values.

`november-bern.u8.gz` is the actual prepared geographic chunk containing that cell. Tests verify its compressed checksum, cell/year/threshold order, missing-record handling, supported/sparse intervals, selected-year exclusion and reproducibility. It is a derived test reference, never a replacement for production observations.
