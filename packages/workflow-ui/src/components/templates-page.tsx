import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmailModule } from '../config';
import { superellipse } from './corner-shape';
import type { TemplateRefInfo } from './template-refs';

/** Template preview page: the list on the left comes from IR, the react-email component renders on the right. */
export interface TemplatePreview {
  html?: string;
  subject?: string;
  error?: string;
  loading: boolean;
}

export interface TemplatesPageProps {
  refs: TemplateRefInfo[];
  /** Email registry from the user's config; keys match the DSL's template keys. */
  emails: Record<string, EmailModule | undefined>;
  selected: string | undefined;
  onSelect: (key: string) => void;
  /** Rendered output for the selected template, produced by the caller. */
  preview: TemplatePreview;
}

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  sms: 'SMS',
  push: 'Push',
  in_app: 'In-App',
  slack: 'Slack',
  survey: 'Survey',
};

/** A prop value may be a user-property reference; render it as {{ path }} to distinguish it from a literal. */
function formatPropValue(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'type' in value) {
    const ref = value as { type: string; path?: string };
    if (ref.type === 'user_property') return `{{ ${ref.path} }}`;
  }
  return String(value);
}

/**
 * One label/value row. A fragment rather than a wrapper so the rows land
 * directly in the parent grid: the label column then sizes to the longest label
 * — a custom header name can be any length and must not wrap — and every row
 * stays aligned with the others.
 *
 * One type size throughout. `mono` switches the face for values that are
 * machine strings (addresses with placeholders, header values, node ids), never
 * the size, so the rows keep a single baseline rhythm.
 */
function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted whitespace-nowrap">{label}</dt>
      <dd className={clsx('text-secondary min-w-0 break-words', mono && 'font-mono text-[13px]')}>
        {children}
      </dd>
    </>
  );
}

export function TemplatesPage({ refs, emails, selected, onSelect, preview }: TemplatesPageProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // at(0) rather than [0]: its return type includes undefined, so the empty-list branch is a real branch
  const active = refs.find((ref) => ref.key === selected) ?? refs.at(0);
  const activeModule = active ? emails[active.key] : undefined;
  const { html, subject, error, loading } = preview;

  return (
    <div className="flex h-full min-h-0">
      {/* Template list */}
      <aside className="border-border bg-card w-72 shrink-0 overflow-y-auto border-r">
        <div className="text-muted px-4 py-3 text-xs font-semibold tracking-wide uppercase">
          {t('emails.title')} · {refs.length}
        </div>
        <ul>
          {refs.map((ref) => {
            const registered = emails[ref.key] !== undefined;
            const isActive = ref.key === active?.key;
            return (
              <li key={ref.key}>
                <button
                  type="button"
                  onClick={() => onSelect(ref.key)}
                  className={`w-full border-l-2 px-4 py-2.5 text-left ${
                    isActive ? 'border-primary bg-selected' : 'hover:bg-hover border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-primary truncate font-mono text-[13px]">{ref.key}</span>
                    {!registered && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
                        {t('emails.noContent')}
                      </span>
                    )}
                  </div>
                  <div className="text-muted mt-0.5 truncate text-xs">
                    {CHANNEL_LABEL[ref.channel] ?? ref.channel} ·{' '}
                    {[...new Set(ref.usages.map((usage) => usage.workflow))].join(', ')}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Preview */}
      <section className="bg-page flex min-w-0 flex-1 flex-col">
        {active === undefined ? (
          <div className="text-muted flex flex-1 items-center justify-center text-sm">
            {t('emails.empty')}
          </div>
        ) : (
          <>
            {/*
              Collapsed shows the two lines that identify a message — who it is
              from and what it says. Everything else (recipients, reply-to,
              preheader, headers, and which workflows send it) is one click away,
              so the header does not push the preview itself off the screen.
            */}
            <div className="border-border bg-card border-b px-6 py-3">
              <div className="flex items-center gap-3">
                <span className="text-primary font-mono text-sm font-semibold">{active.key}</span>
                <span className="bg-selected text-secondary rounded-full px-2 py-0.5 text-xs">
                  {CHANNEL_LABEL[active.channel] ?? active.channel}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
                <Field label={t('emails.from')}>{activeModule?.from ?? t('common.none')}</Field>
                <Field label={t('emails.subject')}>{subject ?? t('common.none')}</Field>

                {expanded && (
                  <>
                    {activeModule?.to !== undefined && (
                      <Field label={t('emails.to')} mono>
                        {activeModule.to}
                      </Field>
                    )}
                    {activeModule?.replyTo !== undefined && (
                      <Field label={t('emails.replyTo')}>{activeModule.replyTo}</Field>
                    )}
                    {activeModule?.preheader !== undefined && (
                      <Field label={t('emails.preheader')}>{activeModule.preheader}</Field>
                    )}
                    {activeModule?.cc !== undefined && (
                      <Field label={t('emails.cc')}>{activeModule.cc.join(', ')}</Field>
                    )}
                    {activeModule?.bcc !== undefined && (
                      <Field label={t('emails.bcc')}>{activeModule.bcc.join(', ')}</Field>
                    )}
                    {activeModule?.headers !== undefined &&
                      Object.entries(activeModule.headers).map(([name, value]) => (
                        <Field key={name} label={name} mono>
                          {value}
                        </Field>
                      ))}

                    {/* One line per use site: the same template can take different props in different flows */}
                    <Field label={t('emails.sentBy')} mono>
                      {active.usages.map((usage) => (
                        <div key={`${usage.workflow}:${usage.nodeId}`}>
                          {usage.workflow}
                          <span className="text-muted"> #{usage.nodeId}</span>
                          {Object.keys(usage.props).length > 0 && (
                            <span className="text-muted">
                              {'  '}
                              {Object.entries(usage.props)
                                .map(([name, value]) => `${name}=${formatPropValue(value)}`)
                                .join('  ')}
                            </span>
                          )}
                        </div>
                      ))}
                    </Field>
                  </>
                )}
              </dl>

              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                className="text-muted hover:text-primary mt-2 -ml-1 flex items-center gap-1 rounded px-1 text-xs transition-colors"
              >
                <ChevronRight
                  className={clsx('size-3.5 transition-transform', expanded && 'rotate-90')}
                  strokeWidth={2}
                />
                {t(expanded ? 'emails.hideDetails' : 'emails.showDetails')}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-6">
              {activeModule === undefined ? (
                <div
                  className="border-border bg-card mx-auto max-w-xl rounded-2xl border border-dashed p-8 text-center"
                  style={superellipse}
                >
                  <p className="text-primary text-sm font-medium">{t('emails.notRegistered')}</p>
                  <p className="text-muted mt-2 text-sm">
                    {t('emails.notRegisteredHint', { key: active.key })}
                  </p>
                </div>
              ) : loading ? (
                <div className="text-muted text-center text-sm">{t('emails.rendering')}</div>
              ) : error !== undefined ? (
                <div
                  className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300"
                  style={superellipse}
                >
                  {error}
                </div>
              ) : (
                <iframe
                  title={`${active.key} preview`}
                  srcDoc={html ?? ''}
                  className="border-border bg-card mx-auto h-full w-full max-w-2xl rounded-2xl border"
                  style={superellipse}
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
