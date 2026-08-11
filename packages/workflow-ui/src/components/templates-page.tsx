import { render } from '@react-email/render';
import { type ReactElement, createElement, useEffect, useState } from 'react';
import type { EmailModule } from '../config';
import type { TemplateRefInfo } from './template-refs';

/** Template preview page: the list on the left comes from IR, the react-email component renders on the right. */
export interface TemplatesPageProps {
  refs: TemplateRefInfo[];
  /** Email registry from the user's config; keys match the DSL's template keys. */
  emails: Record<string, EmailModule | undefined>;
  selected: string | undefined;
  onSelect: (key: string) => void;
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

function useRenderedEmail(
  emails: Record<string, EmailModule | undefined>,
  key: string | undefined
) {
  const [state, setState] = useState<{ html?: string; subject?: string; error?: string }>({});

  useEffect(() => {
    if (key === undefined) {
      setState({});
      return;
    }
    const mod = emails[key];
    if (!mod) {
      setState({});
      return;
    }
    let cancelled = false;
    // The module contract narrows props with never (contravariance); restore a concrete shape at the call site
    const props = (mod.preview ?? {}) as Record<string, unknown>;
    const Component = mod.default as (p: Record<string, unknown>) => ReactElement;
    const buildSubject = mod.subject as ((p: Record<string, unknown>) => string) | undefined;
    void (async () => {
      try {
        const html = await render(createElement(Component, props));
        const subject = buildSubject?.(props);
        if (!cancelled) setState({ html, ...(subject !== undefined ? { subject } : {}) });
      } catch (error) {
        if (!cancelled) setState({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [emails, key]);

  return state;
}

export function TemplatesPage({ refs, emails, selected, onSelect }: TemplatesPageProps) {
  // at(0) rather than [0]: its return type includes undefined, so the empty-list branch is a real branch
  const active = refs.find((ref) => ref.key === selected) ?? refs.at(0);
  const activeModule = active ? emails[active.key] : undefined;
  const { html, subject, error } = useRenderedEmail(emails, active?.key);

  return (
    <div className="flex h-full min-h-0">
      {/* Template list */}
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
        <div className="px-4 py-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Templates · {refs.length}
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
                    isActive
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-transparent hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px] text-slate-900">{ref.key}</span>
                    {!registered && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        no content
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
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
      <section className="flex min-w-0 flex-1 flex-col bg-slate-50">
        {active === undefined ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            No templates referenced by the example workflows.
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 bg-white px-6 py-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-semibold text-slate-900">{active.key}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {CHANNEL_LABEL[active.channel] ?? active.channel}
                </span>
              </div>
              {subject !== undefined && (
                <div className="mt-1 text-sm text-slate-600">
                  <span className="text-slate-400">Subject: </span>
                  {subject}
                </div>
              )}
              {/* One line per use site: the same template can take different props in different flows */}
              <ul className="mt-2 space-y-0.5">
                {active.usages.map((usage) => (
                  <li key={`${usage.workflow}:${usage.nodeId}`} className="text-xs text-slate-500">
                    <span className="text-slate-600">{usage.workflow}</span>
                    <span className="text-slate-300"> #{usage.nodeId}</span>
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
                <div className="mx-auto max-w-xl rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <p className="text-sm font-medium text-slate-900">No component registered</p>
                  <p className="mt-2 text-sm text-slate-500">
                    A workflow references{' '}
                    <code className="font-mono text-slate-700">{active.key}</code>, but no
                    react-email component is registered for it in{' '}
                    <code className="font-mono text-slate-700">workflow.config.ts</code>.
                  </p>
                </div>
              ) : error !== undefined ? (
                <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
                  {error}
                </div>
              ) : (
                <iframe
                  title={`${active.key} preview`}
                  srcDoc={html ?? ''}
                  className="mx-auto h-full w-full max-w-2xl rounded-xl border border-slate-200 bg-white"
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
