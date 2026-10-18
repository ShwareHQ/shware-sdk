import { useTranslation } from 'react-i18next';
import { superellipse } from './corner-shape';

/**
 * What every email template shares: `email` in workflow.config.ts — the
 * unsubscribe link of templates that name none of their own, and how opens
 * and clicks are judged. Senders are each template's own (its detail page
 * shows them). Read-only — the config is where it changes; the studio
 * refreshes when it does.
 */
export interface EmailDefaultsProps {
  unsubscribeUrl?: string | undefined;
  quickClickMs?: number | undefined;
}

/** The reporting classifier's default (`email.tracking.quickClickMs`). */
const QUICK_CLICK_MS = 1_000;

export function EmailDefaults({ unsubscribeUrl, quickClickMs }: EmailDefaultsProps) {
  const { t } = useTranslation();
  const rows = [
    { label: t('emails.unsubscribeUrl'), value: unsubscribeUrl },
    {
      label: t('settings.quickClick'),
      value: t('settings.quickClickValue', { ms: quickClickMs ?? QUICK_CLICK_MS }),
    },
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
