import { useId } from 'react';

/**
 * One series over time, filled — the shape a segment's membership takes.
 *
 * Hand-drawn SVG for the same reason the metrics chart is: see the note there.
 * A filled area rather than a bare line because a segment size is a population,
 * and an area reads as "how many are in here" where a line reads as a rate.
 */
export interface SeriesChartProps {
  values: readonly number[];
  /** Optional x labels, same length as `values`; at most six are drawn. */
  labels?: readonly string[];
  height?: number;
  ariaLabel?: string;
}

const PADDING = { top: 12, right: 16, bottom: 28, left: 56 };
/** viewBox units; the SVG scales to whatever width its container gives it. */
const VIEW_WIDTH = 900;

/** A "nice" upper bound, so the axis reads 0/50/100 rather than 0/47/94. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export function SeriesChart({ values, labels, height = 260, ariaLabel }: SeriesChartProps) {
  const gradientId = useId();
  const plotWidth = VIEW_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const max = niceMax(Math.max(...values, 0));
  const stepX = values.length > 1 ? plotWidth / (values.length - 1) : 0;

  const x = (index: number) => PADDING.left + index * stepX;
  const y = (value: number) => PADDING.top + plotHeight - (value / max) * plotHeight;

  const line = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);
  /** The fill closes the line down to the baseline and back. */
  const area = [
    `${PADDING.left},${PADDING.top + plotHeight}`,
    ...line,
    `${x(values.length - 1).toFixed(1)},${PADDING.top + plotHeight}`,
  ].join(' ');

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction));
  /** At most six x labels, so they never collide. */
  const labelEvery = Math.max(1, Math.ceil(values.length / 6));

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-chart-4)" stopOpacity={0.18} />
          <stop offset="100%" stopColor="var(--color-chart-4)" stopOpacity={0} />
        </linearGradient>
      </defs>

      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PADDING.left}
            x2={VIEW_WIDTH - PADDING.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
          <text
            x={PADDING.left - 8}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={11}
            fill="var(--color-muted)"
          >
            {tick.toLocaleString()}
          </text>
        </g>
      ))}

      {labels?.map((label, index) =>
        index % labelEvery === 0 ? (
          <text
            key={label}
            x={x(index)}
            y={height - 8}
            textAnchor="middle"
            fontSize={11}
            fill="var(--color-muted)"
          >
            {label.slice(5)}
          </text>
        ) : null
      )}

      {values.length > 1 && (
        <>
          <polygon points={area} fill={`url(#${gradientId})`} />
          <polyline
            points={line.join(' ')}
            fill="none"
            stroke="var(--color-chart-4)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
