import React, { useId, useState } from 'react';
import { nearestPlotPoint, stepPlotPoint } from './chart-inspection.mjs';

// Inspect existing plotted values only: never interpolate gaps or recompute estimates.
export const chartNumber = (value, digits = 1) =>
  Number.isFinite(value)
    ? value.toFixed(digits)
    : value === Infinity
      ? '∞'
      : value === -Infinity
        ? '−∞'
        : 'Unavailable';

export default function InteractiveChart({
  points = [],
  children,
  axis = 'x',
  hint = true,
  ...props
}) {
  const [active, setActive] = useState(null);
  const [pinned, setPinned] = useState(false);
  const helpId = useId();
  const [, , width, height] = props.viewBox.split(' ').map(Number);
  const point = active === null ? null : points[Math.min(active, points.length - 1)];
  const nearest = (event) => {
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix || !points.length) return null;
    const position = svg.createSVGPoint();
    position.x = event.clientX;
    position.y = event.clientY;
    const local = position.matrixTransform(matrix.inverse());
    return nearestPlotPoint(points, local, axis);
  };
  return (
    <div className="interactive-chart">
      <span id={helpId} className="sr-only">
        Hover or tap to inspect. Left and right arrows move between values. Home and End jump to the
        ends. Click or Enter pins a value; Escape clears it.
      </span>
      <svg
        {...props}
        role="group"
        tabIndex={points.length ? 0 : undefined}
        aria-describedby={helpId}
        onPointerMove={(e) => {
          if (!pinned && e.pointerType !== 'touch') setActive(nearest(e));
        }}
        onPointerLeave={() => {
          if (!pinned) setActive(null);
        }}
        onClick={(e) => {
          const next = nearest(e);
          const clear = pinned && next === active;
          setActive(clear ? null : next);
          setPinned(!clear);
        }}
        onFocus={() => {
          if (active === null && points.length) setActive(0);
        }}
        onBlur={() => {
          if (!pinned) setActive(null);
        }}
        onKeyDown={(e) => {
          if (!points.length) return;
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', 'Enter'].includes(e.key)) {
            e.preventDefault();
            if (e.key === 'Escape') {
              setActive(null);
              setPinned(false);
            } else if (e.key === 'Enter') setPinned(!pinned);
            else {
              setPinned(false);
              setActive(stepPlotPoint(active, points.length, e.key));
            }
          }
        }}
      >
        {children}
        {point && (
          <g pointerEvents="none" aria-hidden="true">
            <line
              x1={axis === 'y' ? 0 : point.x}
              x2={axis === 'y' ? width : point.x}
              y1={axis === 'y' ? point.y : 18}
              y2={axis === 'y' ? point.y : height - 38}
              stroke="#64748b"
              strokeDasharray="3 4"
            />
            {Number.isFinite(point.y) && (
              <circle
                cx={point.x}
                cy={point.y}
                r={5}
                fill="#fff"
                stroke="#2563a6"
                strokeWidth={2}
              />
            )}
          </g>
        )}
      </svg>
      {!point && hint && points.length > 0 && (
        <span className="chart-hint" aria-hidden="true">
          Hover · tap · ← →
        </span>
      )}
      {point && (
        <div
          className={`chart-inspector ${point.x > width / 2 ? 'align-left' : 'align-right'}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <strong>{point.title}</strong>
          {point.lines.map((line, i) => (
            <span key={i}>{line}</span>
          ))}
          <small>
            {pinned ? 'Pinned · tap again or Escape to clear' : 'Tap to pin · ← → to explore'}
          </small>
        </div>
      )}
    </div>
  );
}
