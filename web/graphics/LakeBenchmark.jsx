import React, { useEffect, useState } from 'react';

export default function LakeBenchmark({ id }) {
  const [report, setReport] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(new URL('data/lake-benchmark.json', document.baseURI), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error('Benchmark unavailable');
        return r.json();
      })
      .then(setReport)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const lake = report?.lakes.find((l) => l.id === id);
  if (!lake) return null;
  return (
    <div className="lake-benchmark">
      <h3>Testing a rainfall-based model</h3>
      <p>
        We tested predictions of this lake’s level on past days in 2016–2025. The model uses recent
        lake levels, recent regional rainfall and the time of year. It does not yet predict when the
        lake will recover.
      </p>
      <div className="table-scroll">
        <table>
          <caption>Average prediction error in the held-out years. Smaller is better.</caption>
          <thead>
            <tr>
              <th>Days ahead</th>
              <th>Model error</th>
              <th>Assume no change</th>
            </tr>
          </thead>
          <tbody>
            {lake.metrics.map((m) => (
              <tr key={m.horizonDays}>
                <th>{m.horizonDays}</th>
                <td>{m.maeCm.toFixed(1)} cm</td>
                <td>{m.persistenceMaeCm.toFixed(1)} cm</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Most of the improvement came from lake levels and seasonality. Adding recent rainfall
        changed the average error by less than 1 mm at each tested horizon. A useful recovery
        forecast will also need future weather, snowmelt, inflows and information about outlet
        operation.
      </p>
      <details>
        <summary>Test uncertainty and limitations</summary>
        <p>
          Training: {report.training}. Model settings and uncertainty widths chosen using{' '}
          {report.tuning}. Final test: {report.testing}. Each forecast used only observations
          available up to its start; rainfall was delayed by one label day to respect its 06:00 UTC
          window. This is a retrospective test with revised historical data, not a test of archived
          live forecasts.
        </p>
        <p>
          Rainfall indicator: {lake.rainfallCells} Swiss grid cells within 20 km east/west and
          north/south of the gauge. This is not the whole catchment; cross-border rainfall is
          particularly important for Lake Constance.
        </p>
        <ul>
          {lake.metrics.map((m) => (
            <li key={m.horizonDays}>
              {m.horizonDays} days: the nominal 90% interval covered{' '}
              {(m.actualCoverage * 100).toFixed(1)}% of test observations; half-width{' '}
              {m.intervalHalfWidthCm.toFixed(1)} cm. Improvement over no change:{' '}
              {m.improvementIntervalCm.map((v) => v.toFixed(1)).join('–')} cm (95% range from
              resampling entire test years).
            </li>
          ))}
        </ul>
        <p>
          Intervals describe level errors, not uncertainty in a recovery date. Daily tests overlap.
          The model has not been validated specifically for unusually low-water episodes, changing
          regulation or future climate.
        </p>
        <a href="data/lake-benchmark.json">Benchmark results and source versions</a>
      </details>
    </div>
  );
}
