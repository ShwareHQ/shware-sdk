import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Profile } from '../config';
import { superellipse } from './corner-shape';

/**
 * A profile's full record, in a panel over the right edge.
 *
 * A drawer rather than a route because the list is the context: you scan the
 * table, open one person to check a property, and go back to scanning. Pushing
 * that through navigation would lose the scroll position every time.
 */
export interface ProfileDrawerProps {
  profile: Profile | undefined;
  onClose: () => void;
}

/** Values come from the user's own store, so render them without assuming a shape. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function ProfileDrawer({ profile, onClose }: ProfileDrawerProps) {
  const { t } = useTranslation();
  const open = profile !== undefined;

  /* Escape closes it: the panel is a detail view, not a decision the user is trapped in. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const properties = Object.entries(profile?.properties ?? {});

  return (
    <>
      {/* The scrim only exists while open, so it never eats clicks on the table. */}
      {open && (
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="absolute inset-0 z-20 cursor-default bg-gray-950/20 dark:bg-gray-950/50"
        />
      )}

      <aside
        aria-hidden={!open}
        className={`border-border bg-card absolute inset-y-0 right-0 z-30 flex w-96 max-w-full flex-col border-l shadow-xl transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{profile?.email ?? profile?.id}</div>
            <div className="text-muted truncate font-mono text-xs">{profile?.id}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-muted hover:bg-hover hover:text-primary flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={superellipse}
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {properties.length === 0 ? (
            <p className="text-muted text-sm">{t('profiles.noProperties')}</p>
          ) : (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
              {properties.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted whitespace-nowrap">{key}</dt>
                  <dd className="text-secondary min-w-0 font-mono text-[13px] break-words">
                    {formatValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </aside>
    </>
  );
}
