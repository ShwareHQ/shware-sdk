import { ArrowUpRight } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { superellipse } from './corner-shape';

/**
 * Dark-mode simulation for a rendered email: emails are authored light, so a
 * dark stage inverts the document and re-inverts imagery. Shared with the
 * templates page so the thumbnail and the full preview agree.
 */
export const DARK_SIMULATION =
  '<style>html{background:#fff;filter:invert(0.92) hue-rotate(180deg)}img,video{filter:invert(1) hue-rotate(180deg)}</style>';

/** The thumbnail is a fixed window; the document behind it must not scroll. */
const NO_SCROLL = '<style>html,body{overflow:hidden}</style>';

/** Emails are laid out for this width; the thumbnail scales that down, never reflows it. */
const EMAIL_WIDTH = 600;

export interface EmailThumbnailProps {
  /** Rendered HTML; absent while loading, on error, or when nothing is registered. */
  html?: string | undefined;
  loading: boolean;
  error?: string | undefined;
  /** False when the IR references a template the emails index does not register. */
  registered: boolean;
  scheme: 'light' | 'dark';
  /** Open the full preview; the whole thumbnail is the affordance. */
  onOpen: () => void;
}

/**
 * The top of an email at postage-stamp size: the document renders at its
 * native width in a sandboxed frame and is scaled to the card, so what shows
 * is exactly what the templates page shows, only smaller. Clicking goes there.
 */
export function EmailThumbnail({
  html,
  loading,
  error,
  registered,
  scheme,
  onOpen,
}: EmailThumbnailProps) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number }>();

  /* The scale follows the card's inner width; measure rather than assume it. */
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (element === null) return;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = box === undefined ? undefined : box.width / EMAIL_WIDTH;
  let status: string | undefined;
  if (!registered) status = t('emails.notRegistered');
  else if (error !== undefined) status = error;
  else if (loading || html === undefined) status = t('emails.rendering');

  return (
    <button
      type="button"
      onClick={onOpen}
      title={t('inspector.openTemplate')}
      className="group border-border focus-visible:ring-accent/40 dark:focus-visible:ring-accent/50 relative mb-4 block h-48 w-full overflow-hidden rounded-xl border text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-3"
      style={{ ...superellipse, backgroundColor: scheme === 'dark' ? '#161616' : '#fff' }}
    >
      <div ref={boxRef} className="absolute inset-0">
        {status !== undefined ? (
          <div
            className={
              error !== undefined
                ? 'flex h-full items-center justify-center px-4 text-center text-xs text-red-600 dark:text-red-300'
                : 'text-muted flex h-full items-center justify-center px-4 text-center text-xs'
            }
          >
            {status}
          </div>
        ) : (
          scale !== undefined &&
          box !== undefined && (
            <iframe
              title={t('inspector.openTemplate')}
              srcDoc={`${html}${scheme === 'dark' ? DARK_SIMULATION : ''}${NO_SCROLL}`}
              /* No scripts, no navigation: this is a picture of a document, not a document. */
              sandbox=""
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none block origin-top-left border-0"
              style={{
                width: EMAIL_WIDTH,
                height: box.height / scale,
                transform: `scale(${scale})`,
              }}
            />
          )
        )}
      </div>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-linear-to-t from-black/60 to-transparent px-3 pt-8 pb-2 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {t('inspector.openTemplate')}
        <ArrowUpRight className="size-3.5" strokeWidth={2} aria-hidden />
      </span>
    </button>
  );
}
