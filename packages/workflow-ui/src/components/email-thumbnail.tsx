import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ThumbnailStatus, ThumbnailWindow } from './thumbnail-window';

/**
 * Dark-mode simulation for a rendered email: emails are authored light, so a
 * dark stage inverts the document and re-inverts imagery. Shared with the
 * templates page so the thumbnail and the full preview agree.
 */
export const DARK_SIMULATION =
  '<style>html{background:#fff;filter:invert(0.92) hue-rotate(180deg)}img,video{filter:invert(1) hue-rotate(180deg)}</style>';

/** The window scrolls the document; the frame itself must never scroll inside it. */
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
  /** Open the full preview — the button under the window. */
  onOpen: () => void;
}

/**
 * The email at postage-stamp size: the document renders at its native width
 * in a sandboxed frame and is scaled to the card, so what shows is exactly
 * what the templates page shows, only smaller. The window scrolls through the
 * whole email; a button beneath it opens the full preview.
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
  /* Native document height, read once the frame has laid out. */
  const [docHeight, setDocHeight] = useState<number>();

  /* The scale follows the window's inner width; measure rather than assume it. */
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

  /* Until the document reports its height, fill the window so the first paint is not blank. */
  const frameHeight =
    box === undefined || scale === undefined
      ? 0
      : Math.max(docHeight ?? 0, Math.ceil(box.height / scale));

  return (
    <ThumbnailWindow
      ref={boxRef}
      className="overflow-x-hidden overflow-y-auto"
      style={{ backgroundColor: scheme === 'dark' ? '#161616' : '#fff' }}
      onOpen={registered ? onOpen : undefined}
    >
      {status !== undefined ? (
        <ThumbnailStatus tone={error !== undefined ? 'error' : 'muted'}>{status}</ThumbnailStatus>
      ) : (
        scale !== undefined && (
          /* Sized to the scaled document, so the window scrolls the whole email. */
          <div style={{ height: frameHeight * scale }}>
            <iframe
              title={t('inspector.openTemplate')}
              srcDoc={`${html}${scheme === 'dark' ? DARK_SIMULATION : ''}${NO_SCROLL}`}
              /*
               * Same-origin so the document's height is readable; no
               * allow-scripts, so nothing in it runs. A picture of a document.
               */
              sandbox="allow-same-origin"
              tabIndex={-1}
              aria-hidden
              onLoad={(event) => {
                const height = event.currentTarget.contentDocument?.documentElement.scrollHeight;
                if (height !== undefined && height > 0) setDocHeight(height);
              }}
              className="pointer-events-none block origin-top-left border-0"
              style={{
                width: EMAIL_WIDTH,
                height: frameHeight,
                transform: `scale(${scale})`,
              }}
            />
          </div>
        )
      )}
    </ThumbnailWindow>
  );
}
