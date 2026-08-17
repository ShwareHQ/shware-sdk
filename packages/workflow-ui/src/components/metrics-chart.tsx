import { useId } from 'react';
import type { MetricPoint } from '../config';

/**
 * The delivery funnel over time: four series on one y scale, because the
 * drop-off between them is the whole point of the picture.
 *
 * Drawn by hand rather than with a charting library. @tanstack/charts was the
 * first choice, but at 0.9.0 `defineChart`'s mark constraint
 * (`ChartMark<unknown, …>`, with the datum in a contravariant position) rejects
 * marks typed over a concrete row, and casting past it forfeits exactly what a
 * typed chart grammar is for. Worth revisiting after 1.0.
 */
export interface MetricsChartProps {
  points: MetricPoint[];
  height?: number;
  ariaLabel?: string;
}

/*
 * A single monochrome ramp, darkening as the funnel narrows: the smallest
 * series is the one that needs the most contrast to stay readable.
 */
export const METRIC_SERIES = [
  { key: 'delivered', color: 'var(--color-chart-1)' },
  { key: 'opened', color: 'var(--color-chart-2)' },
  { key: 'clicked', color: 'var(--color-chart-3)' },
  { key: 'converted', color: 'var(--color-chart-4)' },
] as const;

const PADDING = { top: 12, right: 16, bottom: 28, left: 48 };
/** viewBox units; the SVG scales to whatever width its container gives it. */
const VIEW_WIDTH = 900;

/** A "nice" upper bound, so the axis reads 0/50/100 rather than 0/47/94. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export function MetricsChart({ points, height = 280, ariaLabel = 'Metrics' }: MetricsChartProps) {
  const clipId = useId();
  const plotWidth = VIEW_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const max = niceMax(
    Math.max(...points.flatMap((point) => METRIC_SERIES.map((series) => point[series.key])), 0)
  );
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const x = (index: number) => PADDING.left + index * stepX;
  const y = (value: number) => PADDING.top + plotHeight - (value / max) * plotHeight;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction));
  /** At most six date labels, so they never collide. */
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={PADDING.left} y={PADDING.top} width={plotWidth} height={plotHeight} />
        </clipPath>
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
            fontSize={12}
            fill="var(--color-muted)"
          >
            {tick.toLocaleString()}
          </text>
        </g>
      ))}

      {points.map((point, index) =>
        index % labelEvery === 0 ? (
          <text
            key={point.date}
            x={x(index)}
            y={height - 8}
            textAnchor="middle"
            fontSize={12}
            fill="var(--color-muted)"
          >
            {point.date.slice(5)}
          </text>
        ) : null
      )}

      <g clipPath={`url(#${clipId})`}>
        {METRIC_SERIES.map((series) => (
          <polyline
            key={series.key}
            fill="none"
            stroke={series.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={points
              .map((point, index) => `${x(index).toFixed(1)},${y(point[series.key]).toFixed(1)}`)
              .join(' ')}
          />
        ))}
      </g>
    </svg>
  );
}
