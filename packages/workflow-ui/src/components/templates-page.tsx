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

export type EnvelopeField = 'from' | 'replyTo' | 'subject';

export interface TemplatesPageProps {
  refs: TemplateRefInfo[];
  /** Email registry from the user's config; keys match the DSL's template keys. */
  emails: Record<string, EmailModule | undefined>;
  selected: string | undefined;
  onSelect: (key: string) => void;
  /** Rendered output for the selected template, produced by the caller. */
  preview: TemplatePreview;
  /** Sender address book (config's emails.addresses) — drives the from / reply-to pickers. */
  addresses?: string[];
  /** Write an envelope field back to source. Editing UI only appears when provided. */
  onSaveEnvelope?: (key: string, field: EnvelopeField, value: string) => Promise<void>;
  /** Open the address book manager (the Settings page) — the pickers' tail item. */
  onManageAddresses?: () => void;
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
 * stays aligned with the others. One face, one size throughout.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted whitespace-nowrap">{label}</dt>
      <dd className="text-secondary min-w-0 break-words">{children}</dd>
    </>
  );
}

const MANAGE_SENTINEL = '__manage_addresses__';

/**
 * from / reply-to picker: current value plus the address book, with a
 * "manage addresses" tail that jumps to the Settings page where the book is
 * edited. Styled as quiet text until hovered, so a read pass over the
 * envelope table does not look like a form.
 */
function AddressSelect({
  value,
  addresses,
  noneLabel,
  onSave,
  onManage,
}: {
  value: string | undefined;
  addresses: string[];
  noneLabel: string;
  onSave: (value: string) => Promise<void>;
  onManage?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const options =
    value !== undefined && !addresses.includes(value) ? [value, ...addresses] : addresses;
  return (
    <select
      value={value ?? ''}
      onChange={(event) => {
        const next = event.target.value;
        if (next === MANAGE_SENTINEL) {
          onManage?.();
          return;
        }
        if (next !== '' && next !== value) void onSave(next);
      }}
      className="hover:bg-hover -mx-1.5 -my-0.5 w-full min-w-0 cursor-pointer appearance-none truncate rounded px-1.5 py-0.5"
    >
      {value === undefined && <option value="">{noneLabel}</option>}
      {options.map((address) => (
        <option key={address} value={address}>
          {address}
        </option>
      ))}
      {onManage !== undefined && (
        <option value={MANAGE_SENTINEL}>{t('emails.manageAddresses')}</option>
      )}
    </select>
  );
}

/** Click-to-edit text: a subject template is a string literal, so it edits in place. */
function EditableText({
  value,
  noneLabel,
  onSave,
}: {
  value: string | undefined;
  noneLabel: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  if (draft === undefined) {
    return (
      <button
        type="button"
        onClick={() => setDraft(value ?? '')}
        className="hover:bg-hover -mx-1.5 -my-0.5 w-full cursor-text truncate rounded px-1.5 py-0.5 text-left"
      >
        {value ?? noneLabel}
      </button>
    );
  }
  const commit = () => {
    const next = draft.trim();
    setDraft(undefined);
    if (next !== '' && next !== value) void onSave(next);
  };
  return (
    <input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(undefined);
      }}
      className="border-border -mx-1.5 -my-0.5 w-full rounded border px-1.5 py-0.5 outline-none"
    />
  );
}

export function TemplatesPage({
  refs,
  emails,
  selected,
  onSelect,
  preview,
  addresses = [],
  onSaveEnvelope,
  onManageAddresses,
}: TemplatesPageProps) {
  const { t } = useTranslation();
  // at(0) rather than [0]: its return type includes undefined, so the empty-list branch is a real branch
  const active = refs.find((ref) => ref.key === selected) ?? refs.at(0);
  const activeModule = active ? emails[active.key] : undefined;
  const { html, subject, error, loading } = preview;

  // Write-back needs a module file to patch, so editing waits for registration
  const saveField =
    onSaveEnvelope !== undefined && active !== undefined && activeModule !== undefined
      ? (field: EnvelopeField) => (value: string) => onSaveEnvelope(active.key, field, value)
      : undefined;
  // From / subject / reply-to are email semantics; other channels skip the envelope rows
  const isEmail = active?.channel === 'email';

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
              The full envelope, always visible — one face, one size, roomy
              rows: an editing surface reads better as a calm table than as a
              teaser that unfolds.
            */}
            <div className="border-border bg-card border-b px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="text-primary font-mono text-sm font-semibold">{active.key}</span>
                <span className="bg-selected text-secondary rounded-full px-2 py-0.5 text-xs">
                  {CHANNEL_LABEL[active.channel] ?? active.channel}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2.5 text-sm">
                {isEmail && (
                  <>
                    <Field label={t('emails.from')}>
                      {saveField ? (
                        <AddressSelect
                          value={activeModule?.from}
                          addresses={addresses}
                          noneLabel={t('common.none')}
                          onSave={saveField('from')}
                          onManage={onManageAddresses}
                        />
                      ) : (
                        (activeModule?.from ?? t('common.none'))
                      )}
                    </Field>
                    <Field label={t('emails.subject')}>
                      {saveField ? (
                        <EditableText
                          value={activeModule?.subject}
                          noneLabel={t('common.none')}
                          onSave={saveField('subject')}
                        />
                      ) : (
                        (subject ?? t('common.none'))
                      )}
                    </Field>
                  </>
                )}

                {activeModule?.to !== undefined && (
                  <Field label={t('emails.to')}>{activeModule.to}</Field>
                )}
                {isEmail && (activeModule?.replyTo !== undefined || saveField !== undefined) && (
                  <Field label={t('emails.replyTo')}>
                    {saveField ? (
                      <AddressSelect
                        value={activeModule?.replyTo}
                        addresses={addresses}
                        noneLabel={t('common.none')}
                        onSave={saveField('replyTo')}
                        onManage={onManageAddresses}
                      />
                    ) : (
                      activeModule?.replyTo
                    )}
                  </Field>
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
                    <Field key={name} label={name}>
                      {value}
                    </Field>
                  ))}

                {/* One line per use site: the same template can take different props in different flows */}
                <Field label={t('emails.sentBy')}>
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
              </dl>
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
