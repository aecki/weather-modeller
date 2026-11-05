import React, { useEffect, useState } from 'react';

export function LakeValidation({ id }) {
  const [report, setReport] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(new URL('data/lake-recovery-reference/validation.json', document.baseURI), {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw Error('The validation reference is not available in this release.');
        return r.json();
      })
      .then(setReport)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  if (error) return <p role="status">{error}</p>;
  if (!report) return <p role="status">Loading held-out low-water tests…</p>;
  const lake = report.lakes.find((row) => row.id === id);
  if (!lake)
    return (
      <p>
        Weather-based recovery tests are available for Lake Zurich and Lake Constance. Select either
        lake to inspect its results. Historical comparisons for other lakes remain in Recovery
        model.
      </p>
    );
  const weaker =
    lake.scores.reduce((sum, s) => sum + s.seasonalWeatherBrier - s.baselineBrier, 0) > 0;
  return (
    <section className="lake-validation" aria-label="Lake recovery validation">
      <p className="eyebrow">HELD-OUT LOW-WATER PERIODS</p>
      <h2>Does the recovery model improve the estimates?</h2>
      <p>
        {lake.lowWaterEpisodes} low-water episodes tested in 2016–2025. Genuine archived weather
        forecasts are available for {lake.archivedForecastEpisodes}{' '}
        {lake.archivedForecastEpisodes === 1 ? 'episode' : 'episodes'}; earlier tests use seasonal
        weather scenarios.
      </p>
      {weaker && (
        <p className="outlook-warning">
          This model was less accurate than the lake-history baseline in past low-water tests. Its
          recovery probabilities remain low-confidence research estimates.
        </p>
      )}
      <div className="table-scroll">
        <table>
          <caption>Recovery probability error (Brier score). Lower is better.</caption>
          <thead>
            <tr>
              <th>Days ahead</th>
              <th>Seasonal weather</th>
              <th>Lake-history baseline</th>
              <th>Archived forecast</th>
              <th>Known outcomes</th>
            </tr>
          </thead>
          <tbody>
            {lake.scores.map((s) => (
              <tr key={s.days}>
                <th>{s.days}</th>
                <td>{s.seasonalWeatherBrier?.toFixed(3) ?? '—'}</td>
                <td>{s.baselineBrier?.toFixed(3) ?? '—'}</td>
                <td>{s.archivedForecastBrier?.toFixed(3) ?? '—'}</td>
                <td>{s.knownOutcomes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        The archived-forecast column uses a smaller, later subset. It cannot be compared directly
        with the full-period columns. Current ensemble probabilities have not been independently
        calibrated against a long ensemble-forecast archive.
      </p>
      <p>
        The nominal 90% level band covered {(lake.coverage90 * 100).toFixed(1)}% of observed test
        days in seasonal-weather tests. This is a descriptive check on a small, partly overlapping
        sample; it does not guarantee future coverage.
      </p>
      <div className="table-scroll">
        <table>
          <caption>
            One start per sustained low-water episode. Missing follow-up remains unknown.
          </caption>
          <thead>
            <tr>
              <th>Episode start</th>
              <th>Observed recovery</th>
              <th>Weather forecast</th>
            </tr>
          </thead>
          <tbody>
            {lake.cases.map((c) => (
              <tr key={c.origin}>
                <th>{c.origin}</th>
                <td>
                  {c.observedRecoveryDays !== null
                    ? `${c.observedRecoveryDays} days`
                    : c.observedFollowupDays < 90
                      ? `Unknown after ${c.observedFollowupDays} days`
                      : 'Not within 90 days'}
                </td>
                <td>
                  {c.archivedForecast ? `${c.archivedForecast.forecastDays} days` : 'Not archived'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Training, seasonal reference and source versions</summary>
        <p>{report.split}</p>
        <p>{report.targetBaseline}</p>
        <p>{report.event}</p>
        <p>{report.limits}</p>
        <a href="data/lake-recovery-reference/validation.json">
          Full validation data and source versions
        </a>
      </details>
    </section>
  );
}
