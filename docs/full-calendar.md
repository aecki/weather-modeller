# Full historical rainfall calendar

The shared Overview/Pro Mode calendar accepts dates from 1 January 1961 through the latest completed rainfall day. It is a native date input, with previous/next controls, a yesterday button and explicitly dated historical storm shortcuts. It is not a list of thousands of dates. A selected date persists between modes. Calendar days label the start of the 06:00–06:00 UTC rainfall interval; they do not imply midnight-to-midnight totals.

## Direct official archive lookup

The repository includes a 3.6 MB metadata index, **not a second copy of the multi-gigabyte rainfall archive**. Each final annual RhiresD file is HDF5/NetCDF with uncompressed little-endian float32 chunks shaped as one complete daily 265×370 grid. The index records a byte offset, raw chunk SHA-256 and normalized-grid SHA-256 for every day in all 65 final annual sources (1961–2025), plus provider URL/version/full-file hash, orientation and fill value. The root manifest pins each annual metadata file by hash. This is deliberately limited to the exact verified chunk format; unsupported layouts fail indexing.

The browser requests exactly 392,200 bytes with an HTTP `Range` header from `https://data.geo.admin.ch`. The official endpoint was checked for 206 Partial Content and browser CORS support. A successful response must pass the raw chunk SHA-256, then normalization reverses the axes as declared and maps only missing/fill values to NaN. Invalid negative/infinite amounts fail. The normalized grid must also match its independent reference SHA-256. If the server ignores Range, the response body is cancelled; the browser does **not** download a full annual file. Changed or unavailable provider objects fail explicitly. Original values are neither synthesized nor re-estimated.

This works on GitHub Pages without a modelling backend, proxy, new hosted service or multi-gigabyte static data distribution. The browser caches at most 20 day grids in memory. Changing dates aborts pending requests and hides stale results. No location/date is persisted. CSP allows only the official data host in addition to swisstopo search and map services.

## Recent data and coverage

The daily pipeline publishes the latest 366 rainfall-day labels, including consolidated and preliminary statuses with full provenance. This currently bridges the pinned final archive to yesterday, including earlier days in the current year. Final indexed annual days take precedence over recent-release copies. Every calendar day is selectable; missing provider dates are reported as unavailable, never filled with a neighbouring day or zero. The reference index must be deliberately extended when new final annual archives appear; the calendar alone does not manufacture coverage of an unindexed year after it leaves the rolling release. The monthly and annual model baselines remain independently pinned to 1961–2025.

The same resolver loads all days of a Pro Mode 1/3/5-day accumulation, including days in different annual source files. A missing required day or footprint cell withholds the selected regional total. Model training maxima still use only complete years and windows entirely within their calendar year. At the archive’s start, a multi-day window reaching before 1961 is unavailable; 1-day analysis remains available. Historical comparisons continue excluding the selected year from the same-month reference; regional fits default to selected-year exclusion. Descriptive record facts still describe their stated full baseline.

## Rebuilding the index

Install the optional pinned historical tools inside the repository environment, restore/prepare the pinned monthly reference and verified source files, then run:

```sh
python run.py history-deps
# From the activated repository environment:
python scripts/index_rainfall_archive.py
```

The generator refuses another Python prefix. It verifies every original annual file against the pinned SHA-256, reads raw chunk metadata with h5py, then compares **every daily raw range** after normalization with the independently decoded NetCDF grid before writing the metadata index. No raw annual file is committed. h5py is required only for deliberate index preparation, not ordinary builds or site use.

Ongoing tests verify every annual index hash, source version/hash, complete leap-year date counts, range geometry, a real August 2005 raw-grid fixture, browser normalization, corrupt/truncated responses, 206-only enforcement and cancellation of ignored-range downloads. Scientific station/regional model suites remain unchanged and required.

Source: [MeteoSwiss spatial climate analyses](https://opendatadocs.meteoswiss.ch/c-climate-data/c3-ground-based-climate-data). HDF5 chunk metadata: [h5py low-level dataset API](https://api.h5py.org/h5d.html).
