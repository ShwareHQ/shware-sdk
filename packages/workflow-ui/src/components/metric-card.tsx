import { ArrowDown, ArrowUp, type LucideIcon, Minus } from 'lucide-react';
import { Fragment, type PointerEvent, useId, useState } from 'react';
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
 * One plotted line.
 *
 * A card plots either one series or a total and the parts it decomposes into
 * (email opens split into human and machine). The parts are not independent
 * measurements, which is why they arrive as a list on one card rather than as
 * cards of their own: they only mean anything read against the total.
 */
export interface MetricSeries {
  /** Named in the hover readout, beside its colour swatch. */
  label: string;
  /** One value per bucket, oldest first; as long as `dates`. */
  values: readonly number[];
}

export interface MetricCardProps {
  label: string;
  /** The current bucket, already formatted ('9,280', '26.2%'). */
  value: string;
  /** Period-over-period change, already formatted and signed. */
  delta?: { text: string; trend: Trend };
  /**
   * Bucket dates, oldest first, already formatted: the card has no business
   * knowing the locale, and the hover readout is the only place they are read.
   */
  dates: readonly string[];
  /**
   * Head series first. It gets the strongest shade and the gradient fill; any
   * that follow are its components and share its y scale — plotted against
   * scales of their own, two halves would not visibly add up to the whole.
   */
  series: readonly MetricSeries[];
  /** Formats the extremes in the plot's corners, and the values under the cursor. */
  format: (value: number) => string;
}

/**
 * viewBox units; `preserveAspectRatio="none"` stretches them to the card.
 *
 * The height doubles as the plot's pixel height, which is what lets the hover
 * indicator place its dots with a y taken straight from the viewBox. The two
 * are the same number on purpose — move one and the other has to follow, or
 * the curve stretches vertically and the dots leave it.
 */
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 120;
/** Headroom above the peak so the max label never sits on the curve. */
const TOP_PAD = 22;

/**
 * Successive series, each mixed further toward the card it sits on.
 *
 * Mixing with the surface — rather than stepping down a fixed ramp — is what
 * makes one set of shades work in both themes: it pales toward the white card
 * in light mode and darkens toward the near-black one in dark mode, so the
 * head series is the highest-contrast line either way and the components read
 * as subordinate to it. A second hue was the other option and is not on the
 * table: accent is the only colour in the studio.
 */
const seriesColor = (index: number): string =>
  `color-mix(in oklab, var(--color-accent) ${Math.round(100 * 0.7 ** index)}%, var(--color-card))`;

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

export function MetricCard({ label, value, delta, dates, series, format }: MetricCardProps) {
  const gradientId = useId();
  /** Which bucket the cursor is over; null once it leaves the plot. */
  const [active, setActive] = useState<number | null>(null);

  /* One scale for every line on the card: the components sum to the head
     series, and a shared axis is the only way that addition is visible. */
  const all = series.flatMap((one) => [...one.values]);
  const max = Math.max(...all, 0);
  const min = Math.min(...all, max);
  /* A flat series has no range to scale against; park it on the baseline. */
  const span = max - min || 1;
  const stepX = dates.length > 1 ? VIEW_WIDTH / (dates.length - 1) : 0;
  const yOf = (point: number) => TOP_PAD + (1 - (point - min) / span) * (VIEW_HEIGHT - TOP_PAD);
  const plotted = series.map((one) =>
    one.values.map((point, index) => ({ x: index * stepX, y: yOf(point) }))
  );

  const head = plotted.length > 0 ? plotted[0] : [];
  const line = splinePath(head);
  /* The fill closes the curve to the bottom edge and back to where it started.
     Only the head series gets one: three stacked washes would muddy the plot
     and the components are read as lines against the total, not as volumes. */
  const area = line === '' ? '' : `${line} L ${VIEW_WIDTH} ${VIEW_HEIGHT} L 0 ${VIEW_HEIGHT} Z`;

  const DeltaIcon = delta ? TREND_ICON[delta.trend] : undefined;

  /* The series can be replaced under a held cursor — a new granularity, a new
     channel — so a stale index is a live possibility, not a defensive fiction. */
  const hovered = active !== null && active < dates.length ? active : undefined;

  /**
   * Cursor → bucket. The plot is `preserveAspectRatio="none"`, so its viewBox
   * is stretched to whatever width the card ended up with; only the rendered
   * box knows the real scale, and reading x in viewBox units would leave the
   * indicator a growing distance behind the pointer.
   */
  const trackPointer = (event: PointerEvent<HTMLDivElement>) => {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    if (width === 0 || dates.length === 0) return;
    const index = Math.round(((event.clientX - left) / width) * (dates.length - 1));
    setActive(Math.min(Math.max(index, 0), dates.length - 1));
  };

  return (
    <section
      className="border-border bg-card flex flex-col overflow-hidden rounded-2xl border"
      style={superellipse}
    >
      <div className="px-4 pt-4">
        <h3 className="text-sm font-medium">{label}</h3>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pt-3">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
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
          {/* Components first, head last: where they cross, the total is the
              line you want on top. */}
          {plotted
            .map((points, index) => ({ d: splinePath(points), index }))
            .filter((entry) => entry.d !== '')
            .reverse()
            .map((entry) => (
              <path
                key={entry.index}
                d={entry.d}
                fill="none"
                style={{ stroke: seriesColor(entry.index) }}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                /* The viewBox is stretched, so the stroke must opt out of scaling. */
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </svg>
        {all.length > 0 && (
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
            x={dates.length > 1 ? hovered / (dates.length - 1) : 0}
            date={dates[hovered]}
            rows={series.map((one, index) => ({
              color: seriesColor(index),
              label: one.label,
              value: format(one.values[hovered]),
              y: plotted[index][hovered].y,
            }))}
          />
        )}
      </div>
    </section>
  );
}

/** One line of the readout: which series, what it read, and where its dot goes. */
interface ReadoutRow {
  color: string;
  label: string;
  value: string;
  /** Plot pixels from the top — the viewBox height is the rendered height. */
  y: number;
}

/**
 * Rule, dots and panel for the bucket under the cursor.
 *
 * HTML rather than SVG: a circle drawn in the stretched viewBox renders as an
 * ellipse and the panel would shear with it. A percentage rides the same
 * stretch the curve does, so `x` is a 0–1 fraction of the plot's width, while
 * each `y` is plain pixels.
 *
 * A single-series card drops the swatch and the series name: with one line
 * there is nothing to tell apart, and the card's own heading already says
 * which metric this is.
 */
function HoverReadout({ x, date, rows }: { x: number; date: string; rows: readonly ReadoutRow[] }) {
  const left = `${x * 100}%`;
  const named = rows.length > 1;
  return (
    <div aria-hidden className="pointer-events-none">
      <div className="bg-border absolute inset-y-0 w-px" style={{ left }} />
      {rows.map((row) => (
        <div
          key={row.label}
          className="border-card absolute size-2.5 rounded-full border-2"
          style={{ left, top: row.y, background: row.color, transform: 'translate(-50%, -50%)' }}
        />
      ))}
      {/* Anchored by the same fraction it sits at: the panel hugs the left edge
          at the start of the series and the right edge at the end, so the card
          never clips it. */}
      <div
        className="border-border bg-card shadow-card-shadow absolute top-0 grid items-center gap-x-3 gap-y-1 rounded-lg border px-2.5 py-2 text-xs shadow-md"
        style={{
          ...superellipse,
          left,
          transform: `translateX(-${x * 100}%)`,
          gridTemplateColumns: named ? 'auto 1fr auto' : 'auto',
        }}
      >
        <div className="col-span-full font-medium whitespace-nowrap">{date}</div>
        {rows.map((row) =>
          named ? (
            <Fragment key={row.label}>
              <span
                className="size-3 rounded-sm"
                style={{ ...superellipse, background: row.color }}
              />
              <span className="text-secondary whitespace-nowrap">{row.label}</span>
              <span className="text-right font-medium tabular-nums">{row.value}</span>
            </Fragment>
          ) : (
            <span key={row.label} className="font-medium tabular-nums">
              {row.value}
            </span>
          )
        )}
      </div>
    </div>
  );
}
