import React, { useEffect, useId, useState } from 'react';
import { Mercator } from '@visx/geo';

const color = (value) =>
  !Number.isFinite(value)
    ? '#eef1ed'
    : value < 20
      ? '#bccfce'
      : value < 50
        ? '#6da9a2'
        : value < 100
          ? '#e5b36d'
          : value < 150
            ? '#d87a43'
            : '#a63c2e';
export function StationMap({
  width,
  height = 345,
  countries,
  lakes,
  classicMap,
  stations,
  selected,
  onSelect,
  resetCount,
}) {
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState(null);
  const [showClassic, setShowClassic] = useState(true);
  const clip = useId().replaceAll(':', '');
  useEffect(() => {
    setZoom(1);
  }, [resetCount]);
  const active = stations.find((station) => station.id === (hover || selected));
  const labels = [
    ['FRANCE', 6.0, 46.75],
    ['GERMANY', 8.3, 47.85],
    ['ITALY', 8.25, 45.9],
    ['AUSTRIA', 10.4, 47.0],
  ];
  return (
    <div className="visx-map">
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label="Swiss rainfall station map"
        data-renderer="visx"
      >
        <defs>
          <clipPath id={clip}>
            <rect width={width} height={height} />
          </clipPath>
        </defs>
        <rect width={width} height={height} fill={classicMap && showClassic ? '#fff' : '#edf0f3'} />
        <g clipPath={`url(#${clip})`}>
          <Mercator
            data={countries.features}
            center={[8.22, 46.85]}
            scale={Math.min(width / 0.092, height / 0.061) * zoom}
            translate={[width / 2, height / 2]}
          >
            {({ features, projection, path }) => (
              <>
                {(!classicMap || !showClassic) &&
                  features.map(({ feature, path: shape }, index) => (
                    <path
                      key={index}
                      d={shape || ''}
                      fill={feature.properties.name === 'Switzerland' ? '#fafbfc' : '#edf0f3'}
                      stroke={feature.properties.name === 'Switzerland' ? '#8f9ca9' : '#c5ced7'}
                      strokeWidth={feature.properties.name === 'Switzerland' ? 1.5 : 0.8}
                    />
                  ))}
                {(!classicMap || !showClassic) &&
                  lakes.features.map((feature, index) => (
                    <path
                      key={`lake-${index}`}
                      d={path(feature) || ''}
                      fill="#d8e6f1"
                      stroke="#aec6da"
                      strokeWidth={0.5}
                    />
                  ))}
                {(!classicMap || !showClassic) &&
                  labels.map(([name, lon, lat]) => {
                    const point = projection([lon, lat]);
                    return (
                      <text
                        key={name}
                        x={point[0]}
                        y={point[1]}
                        textAnchor="middle"
                        fill="#64748b"
                        fontSize={9}
                        letterSpacing={2}
                      >
                        {name}
                      </text>
                    );
                  })}
                {classicMap &&
                  showClassic &&
                  (() => {
                    const [west, south, east, north] = classicMap.processing.bounds;
                    const topLeft = projection([west, north]);
                    const bottomRight = projection([east, south]);
                    return (
                      <image
                        href="geography/classic-map.webp"
                        x={topLeft[0]}
                        y={topLeft[1]}
                        width={bottomRight[0] - topLeft[0]}
                        height={bottomRight[1] - topLeft[1]}
                        preserveAspectRatio="none"
                        pointerEvents="none"
                      />
                    );
                  })()}
                {stations.map((station) => {
                  const point = projection([station.lon, station.lat]);
                  const isSelected = station.id === selected;
                  return (
                    <circle
                      key={station.id}
                      cx={point[0]}
                      cy={point[1]}
                      r={isSelected ? 11 : Math.min(10, 5 + Math.sqrt(station.value || 0) / 3)}
                      fill={color(station.value)}
                      stroke={isSelected ? '#173b3e' : '#fff'}
                      strokeWidth={isSelected ? 3 : 1.5}
                      tabIndex={0}
                      role="button"
                      aria-label={`${station.name}: ${Number.isFinite(station.value) ? station.value.toFixed(1) + ' mm' : 'missing rainfall'}`}
                      onClick={() => onSelect(station.id)}
                      onMouseEnter={() => setHover(station.id)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(station.id)}
                      onBlur={() => setHover(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelect(station.id);
                        }
                      }}
                      className="visx-point"
                    >
                      <title>{station.name}</title>
                    </circle>
                  );
                })}
                {active &&
                  (() => {
                    const point = projection([active.lon, active.lat]);
                    const x = Math.max(65, Math.min(width - 65, point[0]));
                    const y = Math.max(30, point[1] - 22);
                    return (
                      <g pointerEvents="none">
                        <rect x={x - 62} y={y - 17} width={124} height={24} rx={4} fill="#173b3e" />
                        <text x={x} y={y - 2} textAnchor="middle" fill="#fff" fontSize={10}>
                          {active.id} ·{' '}
                          {Number.isFinite(active.value)
                            ? active.value.toFixed(1) + ' mm'
                            : 'Missing'}
                        </text>
                      </g>
                    );
                  })()}
              </>
            )}
          </Mercator>
        </g>
      </svg>
      {classicMap && (
        <div className="map-layers">
          <label>
            <input
              type="checkbox"
              checked={showClassic}
              onChange={(event) => setShowClassic(event.target.checked)}
            />
            Topographic map
          </label>
        </div>
      )}
      <div className="map-controls">
        <button
          aria-label="Zoom in"
          disabled={zoom >= 2.2}
          onClick={() => setZoom((value) => Math.min(2.2, value + 0.3))}
        >
          +
        </button>
        <button
          aria-label="Zoom out"
          disabled={zoom <= 1}
          onClick={() => setZoom((value) => Math.max(1, value - 0.3))}
        >
          −
        </button>
      </div>
      <span className="map-credit">
        <a
          href="https://www.swisstopo.admin.ch/en/conditions-geodata"
          target="_blank"
          rel="noreferrer"
        >
          © swisstopo
        </a>
        {' · '}
        <a
          href={
            classicMap && showClassic ? 'geography/classic-map.json' : 'geography/provenance.json'
          }
          target="_blank"
          rel="noreferrer"
        >
          Map sources
        </a>
      </span>
    </div>
  );
}
