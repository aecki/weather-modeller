import React from 'react';
import { ParentSize } from '@visx/responsive';
import { scaleLinear } from '@visx/scale';
import { Bar, Pie } from '@visx/shape';
import { AxisBottom } from '@visx/axis';
const amountLabel = (n) => (n > 0 && n < 0.1 ? 'less than 0.1' : n.toFixed(1));
export function RainAmountGraphic({ amount }) {
  return (
    <div className="rain-amount-graphic">
      <ParentSize>
        {({ width }) => {
          const w = Math.max(240, width),
            max = amount <= 10 ? 10 : amount <= 50 ? 50 : Math.ceil(amount / 50) * 50;
          const x = scaleLinear({ domain: [0, max], range: [0, w - 44] });
          return (
            <svg
              viewBox={`0 0 ${w} 160`}
              role="img"
              aria-label={`${amountLabel(amount)} millimetres of rainfall on a scale from zero to ${max}`}
              data-renderer="visx"
            >
              <text x="20" y="25" fill="#53677e" fontSize="12">
                A whole day of rainfall
              </text>
              <Bar x={20} y={49} width={w - 44} height={40} rx={10} fill="#e7edf4" />
              <Bar x={20} y={49} width={x(amount)} height={40} rx={10} fill="#2878ed" />
              <g transform="translate(20,98)">
                <AxisBottom
                  scale={x}
                  numTicks={4}
                  hideAxisLine
                  hideTicks
                  tickLabelProps={() => ({ fill: '#53677e', fontSize: 12, textAnchor: 'middle' })}
                />
              </g>
              <text x={w - 25} y="148" textAnchor="end" fill="#53677e" fontSize="11">
                millimetres (mm) · daily total
              </text>
            </svg>
          );
        }}
      </ParentSize>
    </div>
  );
}
export function FrequencyDots({ share, dry }) {
  const n = Math.round(100 * share);
  return (
    <div className="frequency-dots">
      <svg
        viewBox="0 0 260 130"
        role="img"
        aria-label={`Approximately ${100 * share < 1 ? 'fewer than one' : n} in 100 past days ${dry ? 'had less than 1 mm' : 'were at least this wet'}`}
        data-renderer="visx"
      >
        {Array.from({ length: 100 }, (_, i) => (
          <Bar
            key={i}
            x={(i % 20) * 13 + 1}
            y={Math.floor(i / 20) * 23 + 4}
            width={8}
            height={15}
            rx={4}
            fill={i < n ? '#2563a6' : '#e7edf4'}
          />
        ))}
      </svg>
      <p>
        <span className="dot-key" /> Each mark represents one out of 100 days. Rounded for display.
      </p>
    </div>
  );
}
export function WetDaysGraphic({ wet, yearLength = 365.25 }) {
  const ratio = Math.min(1, wet / yearLength);
  return (
    <svg
      viewBox="0 0 200 120"
      className="fact-viz"
      role="img"
      aria-label={`About ${Math.round(wet)} days a year had at least one millimetre of regional rainfall`}
      data-renderer="visx"
    >
      <g transform="translate(62,60)">
        <Pie
          data={[ratio, 1 - ratio]}
          pieValue={(d) => d}
          outerRadius={47}
          innerRadius={35}
          padAngle={0.025}
        >
          {(pie) =>
            pie.arcs.map((arc, i) => (
              <path key={i} d={pie.path(arc)} fill={i ? '#e7edf4' : '#2563a6'} />
            ))
          }
        </Pie>
        <text textAnchor="middle" y="5" fontSize="20" fontWeight="650" fill="#163a60">
          {Math.round(ratio * 100)}%
        </text>
      </g>
      <text x="125" y="53" fill="#2563a6" fontSize="12">
        Wetter
      </text>
      <text x="125" y="73" fill="#596775" fontSize="12">
        Drier
      </text>
    </svg>
  );
}
export function RecordGraphic({ record, selected }) {
  const x = scaleLinear({ domain: [0, Math.max(record, selected || 0, 1)], range: [0, 145] });
  return (
    <svg
      viewBox="0 0 220 120"
      className="fact-viz"
      role="img"
      aria-label={`Regional rainfall: record ${record.toFixed(1)} mm${selected === null ? '' : `, selected day ${amountLabel(selected)} mm`}`}
      data-renderer="visx"
    >
      <text x="5" y="18" fill="#596775" fontSize="11">
        Wettest day
      </text>
      <Bar x={5} y={26} width={x(record)} height={15} rx={4} fill="#2563a6" />
      <text x="5" y="69" fill="#596775" fontSize="11">
        Your selected day
      </text>
      {selected !== null && (
        <Bar x={5} y={77} width={x(selected)} height={15} rx={4} fill="#9ebcdb" />
      )}
      <text x="5" y="112" fill="#596775" fontSize="10">
        Same region · one-day totals
      </text>
    </svg>
  );
}
