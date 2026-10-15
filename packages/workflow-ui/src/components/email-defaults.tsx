import { useTranslation } from 'react-i18next';
import { superellipse } from './corner-shape';

/**
 * The envelope every email goes out with: `emails.from` / `replyTo` in
 * workflow.config.ts. Read-only — the config is where it changes; the studio
 * refreshes when it does.
 */
export interface EmailDefaultsProps {
  from?: string | undefined;
  replyTo?: string | undefined;
}

export function EmailDefaults({ from, replyTo }: EmailDefaultsProps) {
  const { t } = useTranslation();
  const rows = [
    { label: t('emails.from'), value: from },
    { label: t('emails.replyTo'), value: replyTo },
  ];

  return (
    <section
      className="border-border bg-card mt-4 max-w-xl rounded-2xl border p-5"
      style={superellipse}
    >
      <h2 className="text-sm font-medium">{t('settings.emailDefaults')}</h2>
      <p className="text-muted mt-1 text-xs">{t('settings.emailDefaultsHint')}</p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted">{row.label}</dt>
            <dd className="text-secondary min-w-0 truncate">
              {row.value ?? t('common.notConfigured')}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
