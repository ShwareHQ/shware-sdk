import { ArrowDown, ArrowUp, CircleQuestionMark, type LucideIcon, Minus } from 'lucide-react';
import { useId } from 'react';
import { cn } from '../utils/cn';
import { superellipse } from './corner-shape';

/**
 * One metric of the delivery funnel: what it is worth right now, which way it
 * moved, and its shape over the queried range.
 *
 * Four of these replace the single four-series line chart. That chart made the
 * drop-off between the stages legible and nothing else — every series but the
 * first was pinned to the floor by a shared y axis, so a 2% swing in clicks was
 * invisible. Each card gets its own scale instead, which is what you want once
 * the funnel's shape is a known quantity and the question becomes "is today
 * normal for this stage".
 *
 * Hand-drawn SVG, like every other chart here — see the note in sparkline.tsx.
 */

/** Which way a delta points; `flat` is an exact zero, not a rounding of one. */
export type Trend = 'up' | 'down' | 'flat';

export interface MetricCardProps {
  label: string;
  /** The metric's definition, shown on the `?`. Every rate needs its denominator stated. */
  help: string;
  /** The current bucket, already formatted ('9,280', '26.2%'). */
  value: string;
  /** Period-over-period change, already formatted and signed. */
  delta?: { text: string; trend: Trend };
  /** Channel glyph, top right. */
  icon: LucideIcon;
  /** One number per bucket, oldest first. */
  values: readonly number[];
  /** Formats the extremes labelled in the plot's corners. */
  format: (value: number) => string;
}

/** viewBox units; `preserveAspectRatio="none"` stretches them to the card. */
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 96;
/** Headroom above the peak so the max label never sits on the curve. */
const TOP_PAD = 22;

interface Point {
  x: number;
  y: number;
}

/**
 * A cardinal spline through every point. The samples are daily counts, not a
 * continuous signal, so the curve is a reading aid rather than interpolation —
 * which is why it is allowed to overshoot slightly between points.
 */
function splinePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const first = points[0];
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    /* Clamped neighbours, so the end segments bend the same way as the middle. */
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

const TREND_STYLE: Record<Trend, string> = {
  up: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  down: 'bg-red-500/10 text-red-600 dark:text-red-400',
  flat: 'bg-selected text-secondary',
};

const TREND_ICON: Record<Trend, LucideIcon> = { up: ArrowUp, down: ArrowDown, flat: Minus };

export function MetricCard({
  label,
  help,
  value,
  delta,
  icon: Icon,
  values,
  format,
}: MetricCardProps) {
  const gradientId = useId();

  const max = Math.max(...values, 0);
  const min = Math.min(...values, max);
  /* A flat series has no range to scale against; park it on the baseline. */
  const span = max - min || 1;
  const stepX = values.length > 1 ? VIEW_WIDTH / (values.length - 1) : 0;
  const points = values.map((point, index) => ({
    x: index * stepX,
    y: TOP_PAD + (1 - (point - min) / span) * (VIEW_HEIGHT - TOP_PAD),
  }));

  const line = splinePath(points);
  /* The fill closes the curve to the bottom edge and back to where it started. */
  const area = line === '' ? '' : `${line} L ${VIEW_WIDTH} ${VIEW_HEIGHT} L 0 ${VIEW_HEIGHT} Z`;

  const DeltaIcon = delta ? TREND_ICON[delta.trend] : undefined;

  return (
    <section
      className="border-border bg-card flex flex-col overflow-hidden rounded-2xl border"
      style={superellipse}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium">{label}</h3>
          <span title={help} aria-label={help} className="text-muted cursor-help">
            <CircleQuestionMark size={14} strokeWidth={2} aria-hidden />
          </span>
        </div>
        <Icon size={16} strokeWidth={2} aria-hidden className="text-muted shrink-0" />
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pt-3">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
        {delta !== undefined && DeltaIcon !== undefined && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              TREND_STYLE[delta.trend]
            )}
          >
            <DeltaIcon size={12} strokeWidth={2.5} aria-hidden />
            {delta.text}
          </span>
        )}
      </div>

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height: VIEW_HEIGHT }}
          role="img"
          aria-label={label}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-4)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-chart-4)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {area !== '' && <path d={area} fill={`url(#${gradientId})`} />}
          {line !== '' && (
            <path
              d={line}
              fill="none"
              stroke="var(--color-chart-4)"
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              /* The viewBox is stretched, so the stroke must opt out of scaling. */
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {values.length > 0 && (
          <>
            <span className="text-muted pointer-events-none absolute top-0 left-4 text-xs tabular-nums">
              {format(max)}
            </span>
            <span className="text-muted pointer-events-none absolute right-4 bottom-1 text-xs tabular-nums">
              {format(min)}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
