import { ArrowUpRight } from 'lucide-react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';
import { Button } from './button';
import { superellipse } from './corner-shape';

/**
 * The inspector's preview window: a fixed-height box at the head of the card
 * with, when the template is registered, a button beneath it that opens the
 * full preview. What goes in the box is the channel's business.
 */
export function ThumbnailWindow({
  ref,
  className,
  style,
  onOpen,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
  /** Omit when there is nothing to open — an unregistered template has no page. */
  onOpen?: (() => void) | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-4">
      <div
        ref={ref}
        className={cn('border-border h-48 overflow-hidden rounded-xl border', className)}
        style={{ ...superellipse, ...style }}
      >
        {children}
      </div>
      {onOpen !== undefined && (
        <Button size="xs" variant="secondary" className="mt-2 w-full gap-1" onClick={onOpen}>
          {t('inspector.openTemplate')}
          <ArrowUpRight className="size-3.5" strokeWidth={2} aria-hidden />
        </Button>
      )}
    </div>
  );
}

/** A centred line for a window with nothing to draw: loading, unregistered, or failed. */
export function ThumbnailStatus({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'error';
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center px-4 text-center text-xs',
        tone === 'error' ? 'text-red-600 dark:text-red-300' : 'text-muted'
      )}
    >
      {children}
    </div>
  );
}
