import React from 'react';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleLinear, scaleLog } from '@visx/scale';
import { AreaClosed, LinePath } from '@visx/shape';

const ticks = { fill: '#718180', fontSize: 10, fontFamily: 'inherit' };
const margin = { left: 57, right: 20, top: 24, bottom: 43 };
export function ReturnLevelChart({
  width,
  curve,
  observations,
  period,
  level,
  confidence,
  years,
  showBand,
  otherName,
}) {
  const height = 330,
    innerWidth = Math.max(1, width - margin.left - margin.right),
    innerHeight = height - margin.top - margin.bottom;
  const x = scaleLog({ domain: [2, 500], range: [0, innerWidth] });
  const maxima = [...observations]
    .sort((a, b) => b.value - a.value)
    .map((row, index) => ({ ...row, period: (observations.length + 1) / (index + 1) }))
    .filter((row) => row.period >= 2);
  const y = scaleLinear({
    domain: [
      Math.min(0, ...curve.map((row) => (showBand ? row.lower : row.value))),
      Math.max(
        1,
        ...curve.map((row) => (showBand ? row.upper : row.value)),
        ...maxima.map((row) => row.value),
        ...curve.map((row) => Math.max(row.value, row.other ?? 0)),
      ) * 1.06,
    ],
    range: [innerHeight, 0],
    nice: true,
  });
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Return-level curve with ${confidence}% pointwise bootstrap interval`}
      data-renderer="visx"
    >
      <Group left={margin.left} top={margin.top}>
        <rect
          x={x(years)}
          width={innerWidth - x(years)}
          height={innerHeight}
          fill="#f4dfbd"
          opacity={0.3}
        />
        <text x={Math.min(x(years) + 7, innerWidth - 80)} y={12} fill="#a57b46" fontSize={9}>
          Extrapolation
        </text>
        <GridRows scale={y} width={innerWidth} numTicks={5} stroke="#e4e9e2" />
        <AxisLeft
          scale={y}
          numTicks={5}
          hideTicks
          hideAxisLine
          tickLabelProps={() => ({ ...ticks, textAnchor: 'end', dx: -5 })}
          label="Rainfall (mm)"
          labelProps={{ ...ticks, fill: '#526c67', textAnchor: 'middle' }}
        />
        <AxisBottom
          top={innerHeight}
          scale={x}
          tickValues={[2, 5, 10, 20, 50, 100, 200, 500]}
          tickFormat={(value) => String(value)}
          hideTicks
          hideAxisLine
          tickLabelProps={() => ({ ...ticks, textAnchor: 'middle', dy: 5 })}
          label="Return period (years, logarithmic scale)"
          labelOffset={25}
          labelProps={{ ...ticks, textAnchor: 'middle' }}
        />
        {showBand && (
          <AreaClosed
            data={curve}
            x={(row) => x(row.period)}
            y0={(row) => y(row.lower)}
            y1={(row) => y(row.upper)}
            yScale={y}
            fill="#82ada4"
            opacity={0.25}
          />
        )}
        {otherName && (
          <LinePath
            data={curve}
            x={(row) => x(row.period)}
            y={(row) => y(row.other)}
            stroke="#b48b65"
            strokeWidth={1.7}
            strokeDasharray="5 4"
          />
        )}
        <LinePath
          data={curve}
          x={(row) => x(row.period)}
          y={(row) => y(row.value)}
          stroke="#277c78"
          strokeWidth={2.5}
        />
        {maxima.map((row) => (
          <circle
            key={row.year}
            cx={x(row.period)}
            cy={y(row.value)}
            r={3.5}
            fill="#fafbf7"
            stroke="#173b3e"
            strokeWidth={1.2}
          >
            <title>{`${row.year}: observed ${row.value.toFixed(1)} mm; plotting position ${row.period.toFixed(1)} years`}</title>
          </circle>
        ))}
        <line
          x1={x(period)}
          x2={x(period)}
          y1={0}
          y2={innerHeight}
          stroke="#b37748"
          strokeDasharray="3 3"
        />
        <circle cx={x(period)} cy={y(level)} r={5} fill="#c58252" stroke="#fff" strokeWidth={1.5} />
      </Group>
    </svg>
  );
}
export function DiagnosticChart({ width, points, kind }) {
  const height = 218,
    m = { left: 45, right: 16, top: 15, bottom: 38 },
    iw = Math.max(1, width - m.left - m.right),
    ih = height - m.top - m.bottom;
  const domain =
    kind === 'qq'
      ? [
          Math.min(0, ...points.flatMap((point) => [point.x, point.y])),
          Math.max(...points.flatMap((point) => [point.x, point.y])) * 1.05,
        ]
      : [
          Math.min(...points.map((point) => point.x)) - 1,
          Math.max(...points.map((point) => point.x)) + 1,
        ];
  const x = scaleLinear({ domain, range: [0, iw] });
  const y = scaleLinear({
    domain: kind === 'qq' ? domain : [0, Math.max(...points.map((point) => point.y)) * 1.1],
    range: [ih, 0],
    nice: true,
  });
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={
        kind === 'qq'
          ? 'Observed versus fitted annual maxima'
          : 'Annual rainfall maxima over the fitting period'
      }
      data-renderer="visx"
    >
      <Group left={m.left} top={m.top}>
        <GridRows scale={y} width={iw} numTicks={4} stroke="#e4e9e2" />
        <AxisLeft
          scale={y}
          numTicks={4}
          hideTicks
          hideAxisLine
          tickLabelProps={() => ({ ...ticks, textAnchor: 'end', dx: -4 })}
        />
        <AxisBottom
          top={ih}
          scale={x}
          numTicks={4}
          tickFormat={(value) =>
            kind === 'history' ? String(Math.round(value)) : Number(value).toFixed(0)
          }
          hideTicks
          hideAxisLine
          tickLabelProps={() => ({ ...ticks, textAnchor: 'middle', dy: 4 })}
          label={kind === 'qq' ? 'Fitted quantile (mm)' : 'Year'}
          labelOffset={24}
          labelProps={{ ...ticks, textAnchor: 'middle' }}
        />
        {kind === 'qq' && (
          <LinePath
            data={[
              { x: domain[0], y: domain[0] },
              { x: domain[1], y: domain[1] },
            ]}
            x={(point) => x(point.x)}
            y={(point) => y(point.y)}
            stroke="#b3bdb4"
            strokeDasharray="4 3"
          />
        )}
        {points.map((point) => (
          <circle
            key={point.year}
            cx={x(point.x)}
            cy={y(point.y)}
            r={3.5}
            fill="#6f9f94"
            stroke="#fff"
          >
            <title>{`${point.year}: observed ${point.y.toFixed(1)} mm${kind === 'qq' ? `; fitted ${point.x.toFixed(1)} mm` : ''}`}</title>
          </circle>
        ))}
      </Group>
    </svg>
  );
}
