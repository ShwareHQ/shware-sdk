import { ChevronDown, Minus, Monitor, Moon, Plus, Smartphone, Sun } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmailModule } from '../config';
import { cn } from '../utils/cn';
import { superellipse } from './corner-shape';
import type { TemplateRefInfo } from './template-refs';

/** Template preview page: the list on the left comes from IR, the react-email component renders on the right. */
export interface TemplatePreview {
  html?: string;
  subject?: string;
  error?: string;
  loading: boolean;
}

/** Mirrors the server's EnvelopeField; `name` / `description` are labels, the rest is envelope. */
export type EnvelopeField = 'from' | 'replyTo' | 'subject' | 'name' | 'description';

export interface TemplatesPageProps {
  refs: TemplateRefInfo[];
  /** Email registry from the user's config; keys match the DSL's template keys. */
  emails: Record<string, EmailModule | undefined>;
  selected: string | undefined;
  /** Rendered output for the selected template, produced by the caller. */
  preview: TemplatePreview;
  /** Sender address book (config's emails.addresses) — drives the from / reply-to pickers. */
  addresses?: string[];
  /** Write an envelope field back to source. Editing UI only appears when provided. */
  onSaveEnvelope?: (key: string, field: EnvelopeField, value: string) => Promise<void>;
  /** Open the address book manager (the Settings page) — the pickers' tail item. */
  onManageAddresses?: () => void;
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

/*
 * Rough dark-mode simulation, the invert-and-rotate trick: emails carry their
 * own fixed colours, so this approximates what Gmail-style forced dark does to
 * them. Images are re-inverted to keep their real colours.
 */
/*
 * The explicit white background matters: email bodies are often transparent,
 * and the white behind them is the iframe element's own — outside the
 * document, where the filter cannot reach. Painting it inside makes it flip.
 */
const DARK_SIMULATION =
  '<style>html{background:#fff;filter:invert(0.92) hue-rotate(180deg)}img,video{filter:invert(1) hue-rotate(180deg)}</style>';

/** One control on the floating preview toolbar: a round 32px icon button. */
function ToolButton({
  active = false,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-full transition-colors',
        active ? 'bg-selected text-primary' : 'text-muted hover:bg-hover hover:text-primary'
      )}
    >
      {children}
    </button>
  );
}

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

/**
 * Click-to-edit for one source literal. Reads as text until clicked, so a panel
 * of these still reads as a summary — which matters because most of what the
 * studio shows is not editable, and the few things that are should not shout.
 */
export function EditableText({
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
        /* Transparent border, same 1px as the input state — swapping must not shift layout. */
        className="hover:bg-hover -mx-1.5 -my-0.5 w-full cursor-text truncate rounded border border-transparent px-1.5 py-0.5 text-left"
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
      /* The field colour marks the switch: what looked like text is now clearly an input. */
      className="border-border bg-textfield -mx-1.5 -my-0.5 w-full rounded border px-1.5 py-0.5 outline-none"
    />
  );
}

export function TemplatesPage({
  refs,
  emails,
  selected,
  preview,
  addresses = [],
  onSaveEnvelope,
  onManageAddresses,
}: TemplatesPageProps) {
  const { t } = useTranslation();
  /* Preview chrome: how the rendered email is framed, not what is in it. */
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [zoom, setZoom] = useState(1);
  /* From and Subject by default; the full envelope behind the chevron. */
  const [envelopeOpen, setEnvelopeOpen] = useState(false);
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
  /* Nothing to show at all (non-email, no envelope data) — hide the whole panel. */
  const hasEnvelope =
    isEmail ||
    activeModule?.to !== undefined ||
    activeModule?.preheader !== undefined ||
    activeModule?.cc !== undefined ||
    activeModule?.bcc !== undefined ||
    activeModule?.headers !== undefined;

  return (
    <div className="flex h-full min-h-0">
      {/* Preview; the template list lives on the /emails index and the header dropdown. */}
      <section className="bg-page flex min-w-0 flex-1 flex-col">
        {active === undefined ? (
          <div className="text-muted flex flex-1 items-center justify-center text-sm">
            {t('emails.empty')}
          </div>
        ) : (
          <>
            {/*
              The envelope, hidden entirely when there is nothing to put in it
              — one face, one size, roomy rows: an editing surface reads better
              as a calm table than as a teaser that unfolds.
            */}
            {hasEnvelope && (
              <div className="border-border bg-card relative border-b px-6 py-4">
                {/* Collapsed by default: From and Subject carry the message; the rest on demand. */}
                <button
                  type="button"
                  aria-expanded={envelopeOpen}
                  aria-label={
                    envelopeOpen ? t('emails.envelopeCollapse') : t('emails.envelopeExpand')
                  }
                  title={envelopeOpen ? t('emails.envelopeCollapse') : t('emails.envelopeExpand')}
                  onClick={() => setEnvelopeOpen((open) => !open)}
                  className="text-muted hover:bg-hover hover:text-primary absolute top-3 right-4 flex size-7 items-center justify-center rounded-lg transition-colors"
                  style={superellipse}
                >
                  <ChevronDown
                    size={16}
                    strokeWidth={2}
                    aria-hidden
                    className={cn('transition-transform', envelopeOpen && 'rotate-180')}
                  />
                </button>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2.5 pr-10 text-sm">
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

                  {/* Name / description are labels, not envelope — edited from the list page. */}
                  {envelopeOpen && (
                    <>
                      {activeModule?.to !== undefined && (
                        <Field label={t('emails.to')}>{activeModule.to}</Field>
                      )}
                      {isEmail &&
                        (activeModule?.replyTo !== undefined || saveField !== undefined) && (
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
                    </>
                  )}
                  {envelopeOpen &&
                    activeModule?.headers !== undefined &&
                    Object.entries(activeModule.headers).map(([name, value]) => (
                      <Field key={name} label={name}>
                        {value}
                      </Field>
                    ))}
                </dl>
              </div>
            )}

            {/*
              Dot grid with the workflow canvas's look (its two themes' exact
              canvas/grid colours, 16px gap), marking everything around the
              rendered email as the studio's surface. It follows the toolbar's
              light/dark toggle rather than the studio theme, so flipping the
              simulated client mode visibly flips the whole stage.
            */}
            <div
              className="relative min-h-0 flex-1"
              style={{
                backgroundColor: scheme === 'dark' ? '#000' : 'var(--color-gray-50)',
                /* 0.5px radius: react-flow draws its dots at r=0.5 for zoom 1. */
                backgroundImage: `radial-gradient(${
                  scheme === 'dark' ? 'var(--color-gray-700)' : 'var(--color-gray-400)'
                } 0.5px, transparent 0.5px)`,
                backgroundSize: '16px 16px',
              }}
            >
              {/* pb clears the floating toolbar, so a fully scrolled email is never hidden under it. */}
              <div className="h-full overflow-auto p-6 pb-24">
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
                    srcDoc={scheme === 'dark' ? `${html ?? ''}${DARK_SIMULATION}` : (html ?? '')}
                    /*
                     * Sized to its document rather than the pane, so long emails
                     * scroll in the outer container — which can pad past the
                     * floating toolbar; an iframe scrolling internally cannot.
                     */
                    onLoad={(event) => {
                      const frame = event.currentTarget;
                      const height = frame.contentDocument?.documentElement?.scrollHeight;
                      if (height !== undefined && height > 0) frame.style.height = `${height}px`;
                    }}
                    /*
                     * Square corners — this box IS the email's viewport, not a
                     * studio card. Border and fill follow the toolbar's
                     * light/dark toggle with the stage, not the studio theme.
                     */
                    className="mx-auto min-h-40 border"
                    style={{
                      borderColor:
                        scheme === 'dark' ? 'var(--color-gray-700)' : 'var(--color-gray-300)',
                      backgroundColor: '#fff',
                      width: device === 'mobile' ? 375 : '100%',
                      maxWidth: device === 'mobile' ? 375 : 672,
                      transform: `scale(${zoom})`,
                      transformOrigin: 'top center',
                    }}
                  />
                )}
              </div>

              {/* Floating preview toolbar: client scheme, device width, zoom. */}
              {activeModule !== undefined && !loading && error === undefined && (
                <div className="border-border bg-card absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border p-1 shadow-lg">
                  <ToolButton
                    active={scheme === 'light'}
                    label={t('emails.previewLight')}
                    onClick={() => setScheme('light')}
                  >
                    <Sun size={16} strokeWidth={2} aria-hidden />
                  </ToolButton>
                  <ToolButton
                    active={scheme === 'dark'}
                    label={t('emails.previewDark')}
                    onClick={() => setScheme('dark')}
                  >
                    <Moon size={16} strokeWidth={2} aria-hidden />
                  </ToolButton>
                  <div className="bg-border mx-1 h-4 w-px" />
                  <ToolButton
                    active={device === 'desktop'}
                    label={t('emails.previewDesktop')}
                    onClick={() => setDevice('desktop')}
                  >
                    <Monitor size={16} strokeWidth={2} aria-hidden />
                  </ToolButton>
                  <ToolButton
                    active={device === 'mobile'}
                    label={t('emails.previewMobile')}
                    onClick={() => setDevice('mobile')}
                  >
                    <Smartphone size={16} strokeWidth={2} aria-hidden />
                  </ToolButton>
                  <div className="bg-border mx-1 h-4 w-px" />
                  <ToolButton
                    label={t('emails.zoomOut')}
                    onClick={() => setZoom((level) => Math.max(0.5, level - 0.25))}
                  >
                    <Minus size={16} strokeWidth={2} aria-hidden />
                  </ToolButton>
                  <button
                    type="button"
                    title={t('emails.zoomReset')}
                    onClick={() => setZoom(1)}
                    className="text-secondary hover:text-primary w-11 text-center text-xs font-medium tabular-nums transition-colors"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <ToolButton
                    label={t('emails.zoomIn')}
                    onClick={() => setZoom((level) => Math.min(1.5, level + 0.25))}
                  >
                    <Plus size={16} strokeWidth={2} aria-hidden />
                  </ToolButton>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
