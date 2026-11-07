import InteractiveChart, { chartNumber } from './InteractiveChart.jsx';
import React from 'react';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleLinear, scaleLog } from '@visx/scale';
import { AreaClosed, LinePath } from '@visx/shape';
export const MODEL_COLORS = { gev: '#2563a6', gumbel: '#64748b', gpd: '#ae5738', smev: '#25785e' };
const tick = { fill: '#596575', fontSize: 11, fontFamily: 'inherit' };
const m = { left: 55, right: 18, top: 24, bottom: 68 };
export function ComparisonCurve({ width, curves, bandModel, years, period }) {
  const height = 350,
    w = Math.max(1, width - m.left - m.right),
    h = height - m.top - m.bottom;
  const x = scaleLog({ domain: [2, 500], range: [0, w] });
  const all = curves
    .flatMap((c) =>
      c.rows.flatMap((r) => [r.value, ...(c.model === bandModel ? [r.lower, r.upper] : [])]),
    )
    .filter(Number.isFinite);
  const y = scaleLinear({
    domain: [Math.min(0, ...all), Math.max(1, ...all) * 1.05],
    range: [h, 0],
    nice: true,
  });
  return (
    <InteractiveChart
      points={(curves[0]?.rows ?? []).map((r, i) => ({
        x: m.left + x(r.period),
        y: null,
        title: `${chartNumber(r.period)}-year return period`,
        lines: curves.flatMap((c) => {
          const row = c.rows[i];
          return row
            ? [
                `${c.model.toUpperCase()}: ${chartNumber(row.value)} mm`,
                ...(c.model === bandModel
                  ? [`Interval: ${chartNumber(row.lower)}–${chartNumber(row.upper)} mm`]
                  : []),
              ]
            : [];
        }),
      }))}
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Four-model training return levels and selected pointwise uncertainty band"
      data-renderer="visx"
    >
      <Group left={m.left} top={m.top}>
        <rect x={x(years)} width={w - x(years)} height={h} fill="#f5efe5" />
        <text x={Math.min(x(years) + 6, w - 85)} y={12} fill="#795d3d" fontSize={10}>
          Extrapolation
        </text>
        <GridRows scale={y} width={w} numTicks={5} stroke="#e5e9ef" />
        <AxisLeft
          scale={y}
          hideAxisLine
          hideTicks
          numTicks={5}
          label="Rainfall (mm)"
          labelProps={{ ...tick, textAnchor: 'middle' }}
          tickLabelProps={() => ({ ...tick, textAnchor: 'end', dx: -4 })}
        />
        <AxisBottom
          top={h}
          scale={x}
          tickValues={[2, 5, 10, 20, 50, 100, 200, 500]}
          tickFormat={String}
          label="Return period (years, logarithmic scale)"
          labelOffset={27}
          labelProps={{ ...tick, textAnchor: 'middle' }}
          hideAxisLine
          hideTicks
          tickLabelProps={() => ({ ...tick, textAnchor: 'middle', dy: 5 })}
        />
        {curves
          .filter((c) => c.model === bandModel)
          .map((c) => (
            <AreaClosed
              key={c.model}
              data={c.rows}
              defined={(r) => Number.isFinite(r.lower) && Number.isFinite(r.upper)}
              x={(r) => x(r.period)}
              y0={(r) => y(r.lower)}
              y1={(r) => y(r.upper)}
              yScale={y}
              fill={MODEL_COLORS[c.model]}
              opacity={0.16}
            />
          ))}
        {curves.map((c) => (
          <LinePath
            key={c.model}
            data={c.rows}
            defined={(r) => Number.isFinite(r.value)}
            x={(r) => x(r.period)}
            y={(r) => y(r.value)}
            stroke={MODEL_COLORS[c.model]}
            strokeWidth={c.model === bandModel ? 2.6 : 1.8}
          />
        ))}
        <line x1={x(period)} x2={x(period)} y1={0} y2={h} stroke="#64748b" strokeDasharray="3 4" />
      </Group>
    </InteractiveChart>
  );
}
export function HoldoutHistory({ width, training, test, predictions }) {
  const height = 250,
    w = Math.max(1, width - m.left - m.right),
    h = height - m.top - m.bottom;
  const blocks = [...training, ...test];
  const x = scaleLinear({ domain: [+blocks[0].year - 1, +blocks.at(-1).year + 1], range: [0, w] });
  const y = scaleLinear({
    domain: [
      0,
      Math.max(
        ...blocks.map((b) => b.maximum),
        ...predictions.map((p) => p.level).filter(Number.isFinite),
      ) * 1.1,
    ],
    range: [h, 0],
    nice: true,
  });
  const cut = x(+test[0].year - 0.5);
  return (
    <InteractiveChart
      points={blocks.map((b) => ({
        x: m.left + x(+b.year),
        y: m.top + y(b.maximum),
        title: String(b.year),
        lines: [
          `${training.includes(b) ? 'Training' : 'Held-out'} observation: ${chartNumber(b.maximum)} mm`,
        ],
      }))}
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Training and held-out annual maxima with training-only 10-year return levels"
      data-renderer="visx"
    >
      <Group left={m.left} top={m.top}>
        <rect x={cut} y={0} width={w - cut} height={h} fill="#f5efe5" />
        <text x={Math.min(cut + 5, w - 50)} y={12} fill="#795d3d" fontSize={10}>
          Held out
        </text>
        <GridRows scale={y} width={w} numTicks={4} stroke="#e5e9ef" />
        <AxisLeft
          scale={y}
          hideTicks
          hideAxisLine
          numTicks={4}
          tickLabelProps={() => ({ ...tick, textAnchor: 'end', dx: -4 })}
        />
        <AxisBottom
          scale={x}
          top={h}
          tickFormat={(v) => String(Math.round(v))}
          numTicks={Math.max(2, Math.floor(w / 90))}
          hideTicks
          hideAxisLine
          tickLabelProps={() => ({ ...tick, textAnchor: 'middle', dy: 5 })}
        />
        {predictions
          .filter((p) => Number.isFinite(p.level))
          .map((p) => (
            <line
              key={p.model}
              x1={cut}
              x2={w}
              y1={y(p.level)}
              y2={y(p.level)}
              stroke={MODEL_COLORS[p.model]}
              strokeWidth={1.6}
              strokeDasharray="5 3"
            >
              <title>{`${p.model.toUpperCase()} training-only 10-year return level: ${p.level.toFixed(1)} mm`}</title>
            </line>
          ))}
        {training.map((b) => (
          <circle key={b.year} cx={x(+b.year)} cy={y(b.maximum)} r={3} fill="#94a3b8">
            <title>{`${b.year}: training observation ${b.maximum} mm`}</title>
          </circle>
        ))}
        {test.map((b) => (
          <circle key={b.year} cx={x(+b.year)} cy={y(b.maximum)} r={4} fill="#1f2937" stroke="#fff">
            <title>{`${b.year}: held-out observation ${b.maximum} mm`}</title>
          </circle>
        ))}
      </Group>
    </InteractiveChart>
  );
}
