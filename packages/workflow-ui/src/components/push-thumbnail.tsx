import { useTranslation } from 'react-i18next';
import { IOS_WALLPAPER, IosBanner } from './push-preview';
import { ThumbnailStatus, ThumbnailWindow } from './thumbnail-window';

/**
 * The banner is drawn at its spec size (386pt wide) and zoomed to the card.
 * `zoom` rather than `transform`: it scales layout too, so the wrapper is as
 * tall as what it shows and the banner centres without measuring anything.
 */
const BANNER_ZOOM = 0.68;

export interface PushThumbnailProps {
  /** App identity on the banner; the project title upstream. */
  appName: string;
  /** Shown verbatim, `{prop}` placeholders included — same rule as subjects. */
  title: string;
  body: string;
  /** False when the IR references a template the pushes index does not register. */
  registered: boolean;
  scheme: 'light' | 'dark';
  /** Open the full preview — the button under the window. */
  onOpen: () => void;
}

/**
 * A push at postage-stamp size: the iOS banner on its wallpaper, nothing else.
 * The full page draws both platforms' lock screens; at this size the phone
 * chrome would say nothing the banner does not, so only the banner is shown.
 */
export function PushThumbnail({
  appName,
  title,
  body,
  registered,
  scheme,
  onOpen,
}: PushThumbnailProps) {
  const { t } = useTranslation();
  const dark = scheme === 'dark';
  return (
    <ThumbnailWindow
      className={registered ? 'relative flex items-center' : undefined}
      style={registered ? { background: dark ? IOS_WALLPAPER.dark : IOS_WALLPAPER.light } : {}}
      onOpen={registered ? onOpen : undefined}
    >
      {registered ? (
        <>
          {/* Light behind the glass, so the banner's blur has something to smear. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: dark
                ? 'radial-gradient(circle at 20% 30%, rgba(125,110,255,0.4), transparent 45%), radial-gradient(circle at 85% 80%, rgba(70,150,255,0.32), transparent 45%)'
                : 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.75), transparent 45%), radial-gradient(circle at 85% 80%, rgba(255,170,205,0.7), transparent 45%)',
            }}
          />
          <div className="relative w-full px-[12px]" style={{ zoom: BANNER_ZOOM }}>
            <IosBanner appName={appName} title={title} body={body} dark={dark} />
          </div>
        </>
      ) : (
        <ThumbnailStatus>{t('emails.pushNotRegistered')}</ThumbnailStatus>
      )}
    </ThumbnailWindow>
  );
}
