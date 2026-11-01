import React from 'react';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar } from '@visx/shape';

export function WindowExplanation({ width, samples, total, days, stationName, ending }) {
  const height = 196,
    margin = { left: 25, right: 25, top: 35, bottom: 38 };
  const innerWidth = Math.max(1, width - margin.left - margin.right),
    innerHeight = height - margin.top - margin.bottom;
  const x = scaleBand({
    domain: samples.map((sample) => sample.date),
    range: [0, innerWidth],
    padding: 0.4,
  });
  const y = scaleLinear({
    domain: [0, Math.max(1, ...samples.map((sample) => sample.value ?? 0)) * 1.2],
    range: [innerHeight, 0],
  });
  return (
    <div className="window-example">
      <div className="example-title">
        <span>{stationName} · selected real observations</span>
        <strong>
          {Number.isFinite(total) ? total.toFixed(1) + ' mm' : 'Missing'}
          <small>
            {' '}
            / {days} {days === 1 ? 'day' : 'days'}
          </small>
        </strong>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${days}-day rainfall calculation ending ${ending}`}
        data-renderer="visx"
      >
        <Group left={margin.left} top={margin.top}>
          {samples.map((sample) => (
            <g key={sample.date}>
              <Bar
                x={x(sample.date)}
                y={Number.isFinite(sample.value) ? y(sample.value) : innerHeight - 2}
                width={x.bandwidth()}
                height={
                  Number.isFinite(sample.value) ? Math.max(1, innerHeight - y(sample.value)) : 2
                }
                rx={3}
                fill={Number.isFinite(sample.value) ? '#d7a16e' : '#a0ada5'}
              />
              <text
                x={x(sample.date) + x.bandwidth() / 2}
                y={(Number.isFinite(sample.value) ? y(sample.value) : innerHeight) - 9}
                textAnchor="middle"
                fontSize={11}
                fill="#203c40"
              >
                {Number.isFinite(sample.value) ? sample.value.toFixed(1) : 'Missing'}
              </text>
              <text
                x={x(sample.date) + x.bandwidth() / 2}
                y={innerHeight + 22}
                textAnchor="middle"
                fontSize={10}
                fill="#718180"
              >
                {sample.date.slice(5)}
              </text>
            </g>
          ))}
        </Group>
      </svg>
      <p>
        Each bar is one rainfall day, 06:00–06:00 UTC. Add every day in the selected window. If even
        one is missing, the total is missing too.
      </p>
    </div>
  );
}
