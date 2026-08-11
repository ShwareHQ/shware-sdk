/**
 * Sparkline for the workflows list.
 *
 * A polyline over N points: no axes, no scales, no interaction. Same reasoning
 * as the Metrics tab chart — at this size a charting dependency would only add
 * weight.
 */
export interface SparklineProps {
  values: readonly number[];
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({ values, width = 76, height = 26, className }: SparklineProps) {
  if (values.length < 2) {
    return (
      <svg width={width} height={height} className={className} aria-hidden>
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="var(--color-border)"
          strokeWidth={1.5}
        />
      </svg>
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  // 1px inset top and bottom so the stroke is never clipped
  const points = values
    .map((value, index) => {
      const x = index * stepX;
      const y = height - 1 - ((value - min) / span) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const flat = max === min;

  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={flat ? 'var(--color-border)' : 'var(--color-primary)'}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
