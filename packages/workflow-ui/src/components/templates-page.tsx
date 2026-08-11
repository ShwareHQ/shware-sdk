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

export function TemplatesPage({ refs, emails, selected, onSelect, preview }: TemplatesPageProps) {
  const { t } = useTranslation();
  // at(0) rather than [0]: its return type includes undefined, so the empty-list branch is a real branch
  const active = refs.find((ref) => ref.key === selected) ?? refs.at(0);
  const activeModule = active ? emails[active.key] : undefined;
  const { html, subject, error, loading } = preview;

  return (
    <div className="flex h-full min-h-0">
      {/* Template list */}
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
        <div className="px-4 py-3 text-xs font-semibold tracking-wide text-gray-400 uppercase">
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
                    isActive ? 'border-gray-900 bg-gray-50' : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px] text-gray-900">{ref.key}</span>
                    {!registered && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        {t('emails.noContent')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-gray-500">
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
      <section className="flex min-w-0 flex-1 flex-col bg-gray-50">
        {active === undefined ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
            {t('emails.empty')}
          </div>
        ) : (
          <>
            <div className="border-b border-gray-200 bg-white px-6 py-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-semibold text-gray-900">{active.key}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {CHANNEL_LABEL[active.channel] ?? active.channel}
                </span>
              </div>
              {subject !== undefined && (
                <div className="mt-1 text-sm text-gray-600">
                  <span className="text-gray-400">{t('emails.subject')}: </span>
                  {subject}
                </div>
              )}
              {/* One line per use site: the same template can take different props in different flows */}
              <ul className="mt-2 space-y-0.5">
                {active.usages.map((usage) => (
                  <li key={`${usage.workflow}:${usage.nodeId}`} className="text-xs text-gray-500">
                    <span className="text-gray-600">{usage.workflow}</span>
                    <span className="text-gray-300"> #{usage.nodeId}</span>
                    {Object.keys(usage.props).length > 0 && (
                      <span className="ml-2 font-mono">
                        {Object.entries(usage.props)
                          .map(([name, value]) => `${name}=${formatPropValue(value)}`)
                          .join('  ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-6">
              {activeModule === undefined ? (
                <div
                  className="mx-auto max-w-xl rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center"
                  style={superellipse}
                >
                  <p className="text-sm font-medium text-gray-900">{t('emails.notRegistered')}</p>
                  <p className="mt-2 text-sm text-gray-500">
                    {t('emails.notRegisteredHint', { key: active.key })}
                  </p>
                </div>
              ) : loading ? (
                <div className="text-center text-sm text-gray-500">{t('emails.rendering')}</div>
              ) : error !== undefined ? (
                <div
                  className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"
                  style={superellipse}
                >
                  {error}
                </div>
              ) : (
                <iframe
                  title={`${active.key} preview`}
                  srcDoc={html ?? ''}
                  className="mx-auto h-full w-full max-w-2xl rounded-2xl border border-gray-200 bg-white"
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
