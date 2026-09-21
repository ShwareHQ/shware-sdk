import { useState } from 'react';
import { cn } from '../utils/cn';

/**
 * A person's round portrait, with an initial on a tinted circle behind it.
 *
 * The picture comes from a profile's `properties`, a dictionary the project
 * fills — so it is typed `unknown` here and narrowed rather than asserted: an
 * absent key, a null, or a number all mean the same thing to this component,
 * which is "draw the initial". A URL that resolves to nothing means it too,
 * once the browser says so, so a dead image degrades to the same fallback
 * instead of leaving a broken-image glyph in the row.
 */
export interface AvatarProps {
  /** Straight out of `Profile.properties`; anything but a non-empty string falls back. */
  picture: unknown;
  /** Whatever names the person — a name, an email, an id. Its first letter is the fallback. */
  label: string;
  /** `md` heads the profile drawer; `sm` sits inside a table row. */
  size?: 'sm' | 'md';
}

/* Font scales with the circle: an `sm` initial at `text-sm` crowds the edges. */
const SIZES = {
  sm: 'size-6 text-xs',
  md: 'size-9 text-sm',
} as const;

export function Avatar({ picture, label, size = 'md' }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const src = typeof picture === 'string' && picture !== '' ? picture : undefined;

  if (src !== undefined && !failed) {
    return (
      <img
        src={src}
        /* Decorative: the name or address it sits beside already says who this
           is, and a screen reader repeating it is noise. */
        alt=""
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-full object-cover', SIZES[size])}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        'bg-selected text-secondary flex shrink-0 items-center justify-center rounded-full font-medium',
        SIZES[size]
      )}
    >
      {label.trim().charAt(0).toUpperCase()}
    </div>
  );
}
