import { clsx } from 'clsx';
import { Bell, type LucideIcon, Mail, MessageCircle, MessagesSquare } from 'lucide-react';
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
 * Not pinned: the app header is the only sticky chrome, so the head scrolls
 * away with the rows and needs no opaque fill of its own. The radii stay —
 * the card has no `overflow` to clip with, so its top corners are cut here.
 */
const HEAD_CELL = 'border-border border-b py-3 first:rounded-tl-2xl last:rounded-tr-2xl';

/*
 * One glyph per channel, matching what `channel-icon.ts` hands the analytics
 * views — the same template has to look like itself in both places. Keyed by
 * the IR's channel rather than the analytics one, which splits push by
 * platform and so has no plain `push`.
 */
const ROW_ICON: Record<string, LucideIcon> = {
  push: Bell,
  slack: MessagesSquare,
  discord: MessageCircle,
};

function RowIcon({ channel }: { channel: string | undefined }) {
  const Icon = channel === undefined ? Mail : (ROW_ICON[channel] ?? Mail);
  return <Icon className="text-muted mt-0.5 size-4 shrink-0" strokeWidth={2} />;
}

export function EmailList({ items, onOpen, onEdit }: EmailListProps) {
  const { t } = useTranslation();

  return (
    /*
     * No `overflow` on the card, deliberately: any value at all turns it into
     * a scrollport of its own and draws a second bar inset inside the border —
     * the page is the one scroller (see __root). Nothing clips, so the corners
     * are re-cut on the first and last cells below.
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
                  <RowIcon channel={item.channel} />
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
