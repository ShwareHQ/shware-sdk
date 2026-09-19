import { ArrowDown, ArrowUp, CircleQuestionMark, type LucideIcon, Minus } from 'lucide-react';
import { type PointerEvent, useId, useState } from 'react';
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

/**
 * One plotted bucket. The date arrives already formatted: the card has no
 * business knowing the locale, and the hover readout is the only place it is
 * read, so a display string is the whole of what it needs.
 */
export interface MetricSample {
  date: string;
  value: number;
}

export interface MetricCardProps {
  label: string;
  /** The metric's definition, shown on the `?`. Every rate needs its denominator stated. */
  help: string;
  /** The current bucket, already formatted ('9,280', '26.2%'). */
  value: string;
  /** Period-over-period change, already formatted and signed. */
  delta?: { text: string; trend: Trend };
  /** One sample per bucket, oldest first. */
  samples: readonly MetricSample[];
  /** Formats the extremes in the plot's corners, and the value under the cursor. */
  format: (value: number) => string;
}

/**
 * viewBox units; `preserveAspectRatio="none"` stretches them to the card.
 *
 * The height doubles as the plot's pixel height, which is what lets the hover
 * indicator place its dot with a y taken straight from the viewBox. The two
 * are the same number on purpose — move one and the other has to follow, or
 * the curve stretches vertically and the dot leaves it.
 */
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 120;
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
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-red-600 dark:text-red-400',
  flat: 'text-secondary',
};

const TREND_ICON: Record<Trend, LucideIcon> = { up: ArrowUp, down: ArrowDown, flat: Minus };

export function MetricCard({ label, help, value, delta, samples, format }: MetricCardProps) {
  const gradientId = useId();
  /** Which bucket the cursor is over; null once it leaves the plot. */
  const [active, setActive] = useState<number | null>(null);

  const values = samples.map((sample) => sample.value);
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

  /* The series can be replaced under a held cursor — a new granularity, a new
     channel — so a stale index is a live possibility, not a defensive fiction. */
  const hovered = active !== null && active < points.length ? active : undefined;

  /**
   * Cursor → bucket. The plot is `preserveAspectRatio="none"`, so its viewBox
   * is stretched to whatever width the card ended up with; only the rendered
   * box knows the real scale, and reading x in viewBox units would leave the
   * indicator a growing distance behind the pointer.
   */
  const trackPointer = (event: PointerEvent<HTMLDivElement>) => {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    if (width === 0 || points.length === 0) return;
    const index = Math.round(((event.clientX - left) / width) * (points.length - 1));
    setActive(Math.min(Math.max(index, 0), points.length - 1));
  };

  return (
    <section
      className="border-border bg-card flex flex-col overflow-hidden rounded-2xl border"
      style={superellipse}
    >
      <div className="flex items-center gap-1.5 px-4 pt-4">
        <h3 className="text-sm font-medium">{label}</h3>
        <span title={help} aria-label={help} className="text-muted cursor-help">
          <CircleQuestionMark size={14} strokeWidth={2} aria-hidden />
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pt-3">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
        {delta !== undefined && DeltaIcon !== undefined && (
          <span className={cn('inline-flex items-center gap-1 text-xs', TREND_STYLE[delta.trend])}>
            <DeltaIcon size={12} strokeWidth={2.5} aria-hidden />
            {delta.text}
          </span>
        )}
      </div>

      <div
        className="relative mt-3"
        onPointerMove={trackPointer}
        onPointerLeave={() => setActive(null)}
      >
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
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {area !== '' && <path d={area} fill={`url(#${gradientId})`} />}
          {line !== '' && (
            <path
              d={line}
              fill="none"
              stroke="var(--color-accent)"
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
        {hovered !== undefined && (
          <HoverReadout
            x={points[hovered].x / VIEW_WIDTH}
            y={points[hovered].y}
            date={samples[hovered].date}
            value={format(samples[hovered].value)}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Rule, dot and pill for the bucket under the cursor.
 *
 * HTML rather than SVG: a circle drawn in the stretched viewBox renders as an
 * ellipse and the pill would shear with it. A percentage rides the same
 * stretch the curve does, so `x` is a 0–1 fraction of the plot's width, while
 * `y` is plain pixels — the plot's height is its viewBox height.
 */
function HoverReadout({
  x,
  y,
  date,
  value,
}: {
  x: number;
  y: number;
  date: string;
  value: string;
}) {
  const left = `${x * 100}%`;
  return (
    <div aria-hidden className="pointer-events-none">
      <div className="bg-border absolute inset-y-0 w-px" style={{ left }} />
      <div
        className="bg-accent border-card absolute size-2.5 rounded-full border-2"
        style={{ left, top: y, transform: 'translate(-50%, -50%)' }}
      />
      {/* Anchored by the same fraction it sits at: the pill hugs the left edge
          at the start of the series and the right edge at the end, so the card
          never clips it. */}
      <div
        className="border-border bg-card shadow-card-shadow absolute top-0 flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs whitespace-nowrap shadow-md"
        style={{ ...superellipse, left, transform: `translateX(-${x * 100}%)` }}
      >
        <span className="text-muted">{date}</span>
        <span className="tabular-nums">{value}</span>
      </div>
    </div>
  );
}
