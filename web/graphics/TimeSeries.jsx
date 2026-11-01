import React from 'react';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar, LinePath } from '@visx/shape';

const dateLabel = (date) =>
  new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const format = (value) => (Number.isFinite(value) ? value.toFixed(1) : 'Missing');
const tickStyle = { fill: '#718180', fontSize: 10, fontFamily: 'inherit' };

export function ObservationChart({
  width,
  dates,
  values,
  cursor,
  kind,
  label,
  onSelect,
  releaseStates = [],
}) {
  const height = 208,
    margin = { top: 24, right: 16, bottom: 32, left: 45 };
  const innerWidth = Math.max(1, width - margin.left - margin.right),
    innerHeight = height - margin.top - margin.bottom;
  const y = scaleLinear({
    domain: [0, Math.max(1, ...values.filter(Number.isFinite)) * 1.15],
    range: [innerHeight, 0],
    nice: true,
  });
  const x = scaleBand({ domain: dates, range: [0, innerWidth], padding: 0.3 });
  const center = (index) => (x(dates[index]) ?? 0) + x.bandwidth() / 2;
  const points = dates.map((date, index) => ({ date, value: values[index], index }));
  const unit = kind === 'rain' ? 'mm' : 'm³/s';
  const selected = values[cursor];
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={label}
      data-renderer="visx"
    >
      <text
        x={width - margin.right}
        y={13}
        textAnchor="end"
        fill={kind === 'rain' ? '#a4653c' : '#397f7a'}
        fontSize={10}
      >
        {dateLabel(dates[cursor])} · {format(selected)} {Number.isFinite(selected) ? unit : ''}
        {kind === 'river' && releaseStates[cursor] ? ` · release ${releaseStates[cursor]}` : ''}
      </text>
      <Group left={margin.left} top={margin.top}>
        <GridRows scale={y} width={innerWidth} numTicks={4} stroke="#e4e9e2" />
        <AxisLeft
          scale={y}
          numTicks={4}
          hideAxisLine
          hideTicks
          tickLabelProps={() => ({ ...tickStyle, dx: -4, textAnchor: 'end' })}
        />
        <AxisBottom
          top={innerHeight}
          scale={x}
          tickValues={[dates[0], dates[Math.floor(dates.length / 2)], dates.at(-1)]}
          tickFormat={dateLabel}
          hideAxisLine
          hideTicks
          tickLabelProps={() => ({ ...tickStyle, dy: 6, textAnchor: 'middle' })}
        />
        <line
          x1={center(cursor)}
          x2={center(cursor)}
          y1={0}
          y2={innerHeight}
          stroke="#87968c"
          strokeDasharray="3 3"
        />
        {kind === 'river' && (
          <LinePath
            data={points}
            defined={(point) => Number.isFinite(point.value)}
            x={(point) => center(point.index)}
            y={(point) => y(point.value)}
            stroke="#397f7a"
            strokeWidth={2.5}
          />
        )}
        {points.map(({ date, value, index }) => {
          if (!Number.isFinite(value))
            return (
              <text
                key={date}
                x={center(index)}
                y={innerHeight - 4}
                textAnchor="middle"
                fill="#718180"
                fontSize={13}
              >
                <title>{`${dateLabel(date)}: missing observation`}</title>×
              </text>
            );
          const common = {
            tabIndex: 0,
            role: 'button',
            'aria-label': `${dateLabel(date)}: ${format(value)} ${unit}`,
            onClick: () => onSelect?.(index),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect?.(index);
              }
            },
          };
          return kind === 'rain' ? (
            <Bar
              key={date}
              {...common}
              x={x(date)}
              y={y(value)}
              width={x.bandwidth()}
              height={Math.max(1, innerHeight - y(value))}
              rx={2}
              fill={index === cursor ? '#ba6f40' : '#dfb98f'}
              className="visx-point"
            >
              <title>{`${dateLabel(date)}: ${format(value)} mm`}</title>
            </Bar>
          ) : (
            <circle
              key={date}
              {...common}
              cx={center(index)}
              cy={y(value)}
              r={index === cursor ? 5 : 3.5}
              fill={index === cursor ? '#173b3e' : '#fff'}
              stroke="#397f7a"
              strokeWidth={1.5}
              className="visx-point"
            >
              <title>{`${dateLabel(date)}: ${format(value)} m³/s`}</title>
            </circle>
          );
        })}
      </Group>
    </svg>
  );
}

export function HorizontalBars({ width, rows, selectedId, compact = false }) {
  const rowHeight = compact ? 38 : 35,
    height = rows.length * rowHeight + 4;
  const left = compact ? 70 : 46,
    right = 70,
    innerWidth = Math.max(1, width - left - right);
  const x = scaleLinear({
    domain: [0, Math.max(1, ...rows.map((row) => row.value ?? 0))],
    range: [0, innerWidth],
  });
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={
        compact ? 'Largest complete-year rainfall windows' : 'Peak rainfall comparison by event'
      }
      data-renderer="visx"
    >
      {rows.map((row, index) => (
        <Group key={row.id} top={index * rowHeight + 4}>
          <text x={0} y={12} fill="#203c40" fontSize={11}>
            {row.label}
          </text>
          {compact && (
            <text x={0} y={26} fill="#718180" fontSize={8}>
              {row.detail}
            </text>
          )}
          <Bar x={left} y={5} width={innerWidth} height={compact ? 6 : 10} rx={2} fill="#dce3d7" />
          {Number.isFinite(row.value) && (
            <Bar
              x={left}
              y={5}
              width={x(row.value)}
              height={compact ? 6 : 10}
              rx={2}
              fill={row.id === selectedId ? '#c58252' : '#668d81'}
            />
          )}
          <text x={width} y={12} textAnchor="end" fill="#203c40" fontSize={10}>
            {Number.isFinite(row.value) ? `${format(row.value)} mm` : 'Missing'}
          </text>
        </Group>
      ))}
    </svg>
  );
}
