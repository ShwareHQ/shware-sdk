import { clsx } from 'clsx';
import { Bell, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { displayName } from '../utils/label';
import { superellipse } from './corner-shape';
import { Menu } from './menu';

/**
 * The emails list, mirroring the workflows table: one row per referenced
 * template with its label, whether content is registered for it, and the key
 * the DSL knows it by.
 */
export interface EmailListItem {
  /** Wire key: how workflows reference the template. Identity, not a label. */
  key: string;
  /** Channel from the referencing IR node; picks the row icon. */
  channel?: string;
  /** Human label from the registered module; the list shows this. */
  name?: string;
  description?: string;
  /** False when a workflow references the key but no module is registered. */
  registered: boolean;
}

export interface EmailListProps {
  items: EmailListItem[];
  onOpen: (key: string) => void;
  /** Open the edit dialog for a template; the row menu only appears when provided. */
  onEdit?: (key: string) => void;
}

/*
 * Pinned under the app header (3.5rem) plus the page's search row (4rem), so
 * the head comes to rest exactly where the search field ends. The cells stick
 * and the cells carry the fill: a `thead`'s own background paints in a box no
 * cell radius can clip, which would square off the card's top corners.
 */
const HEAD_CELL =
  'bg-card/95 border-border sticky top-30 z-10 border-b py-3 backdrop-blur first:rounded-tl-2xl last:rounded-tr-2xl';

export function EmailList({ items, onOpen, onEdit }: EmailListProps) {
  const { t } = useTranslation();

  return (
    /*
     * No `overflow` on the card, deliberately: any value at all makes it the
     * sticky scrollport and the head would then pin to the card rather than to
     * the page. The page scrolls (see __root), so the corners are re-cut on the
     * first and last cells below instead of being clipped here.
     */
    <div className="border-border bg-card rounded-2xl border" style={superellipse}>
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-muted text-left text-xs font-medium">
            <th className={clsx(HEAD_CELL, 'min-w-0 px-6')} style={superellipse}>
              {t('common.name')}
            </th>
            <th className={clsx(HEAD_CELL, 'w-28 px-3')} style={superellipse} />
            <th className={clsx(HEAD_CELL, 'w-56 px-3')} style={superellipse}>
              {t('emails.id')}
            </th>
            {onEdit !== undefined && (
              <th className={clsx(HEAD_CELL, 'w-14 px-3')} style={superellipse} />
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.key}
              onClick={() => onOpen(item.key)}
              /*
               * The hover fill lives on the cells, not the row: a row box
               * paints its background underneath them, where no cell radius
               * reaches it, so the last row would poke square grey corners out
               * of the unclipped card.
               */
              className={clsx(
                'hover:[&>td]:bg-hover cursor-pointer align-top [&>td]:transition-colors',
                'last:[&>td]:border-b-0 last:[&>td:first-child]:rounded-bl-2xl',
                'last:[&>td:last-child]:rounded-br-2xl'
              )}
              style={superellipse}
            >
              <td className="border-border border-b px-6 py-4" style={superellipse}>
                <div className="flex items-start gap-3">
                  {item.channel === 'push' ? (
                    <Bell className="text-muted mt-0.5 size-4 shrink-0" strokeWidth={2} />
                  ) : (
                    <Mail className="text-muted mt-0.5 size-4 shrink-0" strokeWidth={2} />
                  )}
                  <div className="min-w-0">
                    <div
                      className={clsx(
                        'font-medium',
                        item.name === undefined ? 'text-muted italic' : 'text-primary'
                      )}
                    >
                      {displayName(item.name, t('common.untitled'))}
                    </div>
                    {item.description !== undefined && (
                      <p className="text-muted mt-1 truncate text-sm">{item.description}</p>
                    )}
                  </div>
                </div>
              </td>

              <td className="border-border border-b px-3 py-4" style={superellipse}>
                <span
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                    item.registered
                      ? 'bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300'
                  )}
                >
                  <span
                    className={clsx(
                      'size-1.5 rounded-full',
                      item.registered ? 'bg-green-500' : 'bg-amber-500'
                    )}
                  />
                  {item.registered ? t('emails.ready') : t('emails.noContent')}
                </span>
              </td>

              <td className="border-border text-secondary border-b px-3 py-4" style={superellipse}>
                <span className="block truncate font-mono">{item.key}</span>
              </td>

              {onEdit !== undefined && (
                <td className="border-border border-b px-3 py-4" style={superellipse}>
                  <Menu
                    aria-label={t('common.more')}
                    items={[
                      { key: 'edit', label: t('common.edit'), onSelect: () => onEdit(item.key) },
                    ]}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
