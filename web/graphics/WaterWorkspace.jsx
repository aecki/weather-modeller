import React, { useEffect, useState } from 'react';
import { LakeOverview } from './WaterOverview';
import { HydroNetwork } from './StationNetwork';
import { LakeValidation } from './LakeValidation';

export function WaterWorkspace({ mode = 'overview', panel = 'records' }) {
  const [lakeId, setLakeId] = useState('2209'),
    [gaugeId, setGaugeId] = useState('2209'),
    [directory, setDirectory] = useState(null);
  const [recordsStarted, setRecordsStarted] = useState(false);
  useEffect(() => {
    if (mode === 'pro' && panel === 'records') setRecordsStarted(true);
  }, [mode, panel]);
  const lake = directory?.lakes.find((l) => l.id === lakeId);
  const chooseLake = (value) => {
    setLakeId(value);
    setGaugeId(value);
  };
  const chooseGauge = (value) => {
    setGaugeId(value);
    if (directory?.lakes.some((l) => l.id === value)) setLakeId(value);
  };
  function jump(e, id) {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  }
  return (
    <section className="water-workspace" aria-labelledby="water-title">
      <p className="eyebrow">SWISS WATER LEVELS · FOEN OBSERVATIONS</p>
      <h1 id="water-title">
        {mode === 'pro'
          ? panel === 'records'
            ? 'Lake and river records'
            : (lake?.label ?? 'Lake recovery analysis')
          : 'Water levels and recovery'}
      </h1>
      <p className="workspace-intro">
        {mode === 'pro'
          ? 'Inspect measurements, catchment-weather recovery models and their performance on past low-water periods.'
          : 'Compare measured lake levels with their usual seasonal range and explore the recovery outlook.'}
      </p>
      {mode === 'pro' ? (
        <nav className="workspace-tabs" aria-label="Water analysis views">
          <a href="#water-pro" aria-current={panel === 'records' ? 'page' : undefined}>
            Records
          </a>
          <a href="#water-recovery" aria-current={panel === 'recovery' ? 'page' : undefined}>
            Recovery model
          </a>
          <a href="#water-validation" aria-current={panel === 'validation' ? 'page' : undefined}>
            Validation
          </a>
        </nav>
      ) : (
        <nav className="overview-topics" aria-label="Water level sections">
          <a href="#water-current" onClick={(e) => jump(e, 'water-current')}>
            Current level
          </a>
          <a
            href="#water-outlook"
            onClick={(e) =>
              jump(e, document.getElementById('water-outlook') ? 'water-outlook' : 'water-history')
            }
          >
            Recovery outlook
          </a>
          <a href="#water-history" onClick={(e) => jump(e, 'water-history')}>
            Historical comparison
          </a>
        </nav>
      )}
      {mode === 'overview' && gaugeId !== lakeId && (
        <p className="selection-note">
          Basic summaries cover lakes. Your separate river or gauge selection is retained in Pro.
        </p>
      )}
      <div id="water-current" hidden={mode === 'pro' && panel !== 'recovery'}>
        <LakeOverview id={lakeId} onSelect={chooseLake} onDirectory={setDirectory} embedded />
      </div>
      <div hidden={mode !== 'pro' || panel !== 'records'}>
        {recordsStarted && <HydroNetwork selectedId={gaugeId} onSelect={chooseGauge} />}
      </div>
      {mode === 'pro' && panel === 'validation' && (
        <>
          <label className="validation-lake">
            Lake{' '}
            <select
              aria-label="Validation lake"
              value={lakeId}
              onChange={(e) => chooseLake(e.target.value)}
            >
              {(
                directory?.lakes ?? [
                  { id: '2209', label: 'Lake Zurich' },
                  { id: '2032', label: 'Lake Constance' },
                ]
              ).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <LakeValidation id={lakeId} />
        </>
      )}
    </section>
  );
}
