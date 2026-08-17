import { clsx } from 'clsx';
import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { displayName } from '../utils/label';
import { Menu } from './menu';

/**
 * The emails list, mirroring the workflows table: one row per referenced
 * template with its label, whether content is registered for it, and the key
 * the DSL knows it by.
 */
export interface EmailListItem {
  /** Wire key: how workflows reference the template. Identity, not a label. */
  key: string;
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

export function EmailList({ items, onOpen, onEdit }: EmailListProps) {
  const { t } = useTranslation();

  return (
    <div className="h-full overflow-auto">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <thead className="bg-page/95 sticky top-0 z-10 backdrop-blur">
          <tr className="text-muted text-left text-xs font-medium">
            <th className="border-border min-w-0 border-b px-6 py-3">{t('common.name')}</th>
            <th className="border-border w-28 border-b px-3 py-3" />
            <th className="border-border w-56 border-b px-3 py-3">{t('emails.id')}</th>
            {onEdit !== undefined && <th className="border-border w-14 border-b px-3 py-3" />}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.key}
              onClick={() => onOpen(item.key)}
              className="hover:bg-hover cursor-pointer align-top transition-colors"
            >
              <td className="border-border border-b px-6 py-4">
                <div className="flex items-start gap-3">
                  <Mail className="text-muted mt-0.5 size-4 shrink-0" strokeWidth={2} />
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

              <td className="border-border border-b px-3 py-4">
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

              <td className="border-border text-secondary border-b px-3 py-4">
                <span className="block truncate font-mono">{item.key}</span>
              </td>

              {onEdit !== undefined && (
                <td className="border-border border-b px-3 py-4">
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
