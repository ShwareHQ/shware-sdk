import { ChevronDown, Minus, Monitor, Moon, Plus, Smartphone, Sun } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatModule, EmailModule, PushModule } from '../config';
import { cn } from '../utils/cn';
import { DiscordPreview, SlackPreview } from './chat-preview';
import { superellipse } from './corner-shape';
import { DARK_SIMULATION } from './email-thumbnail';
import { PushPreview } from './push-preview';
import type { TemplateRefInfo } from './template-refs';

/** Template preview page: the list on the left comes from IR, the react-email component renders on the right. */
export interface TemplatePreview {
  html?: string;
  subject?: string;
  error?: string;
  loading: boolean;
}

/** Mirrors the server's EnvelopeField; `name` / `description` are labels, the rest is envelope. */
export type EnvelopeField =
  | 'from'
  | 'replyTo'
  | 'subject'
  | 'name'
  | 'description'
  | 'title'
  | 'body';

export interface TemplatesPageProps {
  refs: TemplateRefInfo[];
  /** Email registry from the user's config; keys match the DSL's template keys. */
  emails: Record<string, EmailModule | undefined>;
  /** Push registry, same contract as `emails` for the push channel. */
  pushes?: Record<string, PushModule | undefined>;
  /** Slack registry; chat channels keep one registry each (see config.ts). */
  slack?: Record<string, ChatModule | undefined>;
  /** Discord registry, same contract as `slack`. */
  discord?: Record<string, ChatModule | undefined>;
  /** App identity on the push mockups; defaults to the project title upstream. */
  appName?: string;
  selected: string | undefined;
  /** Rendered output for the selected template, produced by the caller. */
  preview: TemplatePreview;
  /** Sender address book (config's emails.addresses) — drives the from / reply-to pickers. */
  addresses?: string[];
  /** Write an envelope field back to source. Editing UI only appears when provided. */
  onSaveEnvelope?: (key: string, field: EnvelopeField, value: string) => Promise<void>;
  /** Open the address book manager (the Settings page) — the pickers' tail item. */
  onManageAddresses?: () => void;
  /**
   * The preview stage's starting light/dark, normally the studio's own theme.
   * The toolbar toggle overrides it for this visit only — leaving the page
   * drops the override, so the stage always reopens matching the studio.
   */
  defaultScheme?: 'light' | 'dark';
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
 * The frame is sized to its document and never scrolls itself — the page is
 * the one scroller. Without this a document whose real height has a
 * fractional part overflows the integer height we set by a fraction of a
 * pixel, which is nothing at all with overlay scrollbars and a permanent bar
 * for anyone whose OS always shows them. The thumbnail carries the same line
 * for the same reason.
 */
const NO_SCROLL = '<style>html,body{overflow:hidden}</style>';

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
  pushes = {},
  slack = {},
  discord = {},
  appName,
  selected,
  preview,
  addresses = [],
  onSaveEnvelope,
  onManageAddresses,
  defaultScheme,
}: TemplatesPageProps) {
  const { t } = useTranslation();
  /* Preview chrome: how the rendered email is framed, not what is in it. */
  /*
   * The stage follows the studio theme until the toggle is clicked; the click
   * is an override held in state only, so a fresh visit follows the theme
   * again — and an untouched stage keeps following live theme switches.
   */
  const [schemeOverride, setSchemeOverride] = useState<'light' | 'dark' | undefined>(undefined);
  const scheme = schemeOverride ?? defaultScheme ?? 'light';
  const setScheme = setSchemeOverride;
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [zoom, setZoom] = useState(1);
  /* From and Subject by default; the full envelope behind the chevron. */
  const [envelopeOpen, setEnvelopeOpen] = useState(false);
  // at(0) rather than [0]: its return type includes undefined, so the empty-list branch is a real branch
  const active = refs.find((ref) => ref.key === selected) ?? refs.at(0);
  /*
   * Each channel reads its own registry, so a push key never shadows an email
   * one. Slack and Discord differ only in which map they read and which
   * surface draws them, so they travel together as one `chat` kind.
   */
  const isPush = active?.channel === 'push';
  const isSlack = active?.channel === 'slack';
  const isDiscord = active?.channel === 'discord';
  const isChat = isSlack || isDiscord;
  const activeModule = active !== undefined && !isPush && !isChat ? emails[active.key] : undefined;
  const activePush = active !== undefined && isPush ? pushes[active.key] : undefined;
  const activeChat =
    active === undefined
      ? undefined
      : isSlack
        ? slack[active.key]
        : isDiscord
          ? discord[active.key]
          : undefined;
  const { html, subject, error, loading } = preview;

  // Write-back needs a module file to patch, so editing waits for registration
  const saveField =
    onSaveEnvelope !== undefined &&
    active !== undefined &&
    (activeModule !== undefined || activePush !== undefined || activeChat !== undefined)
      ? (field: EnvelopeField) => (value: string) => onSaveEnvelope(active.key, field, value)
      : undefined;
  // From / subject / reply-to are email semantics; other channels skip the envelope rows
  const isEmail = active?.channel === 'email';
  /* Whether anything hides behind the chevron; a push shows its two rows outright. */
  const hasCollapsible =
    isEmail ||
    activeModule?.to !== undefined ||
    activeModule?.preheader !== undefined ||
    activeModule?.cc !== undefined ||
    activeModule?.bcc !== undefined ||
    activeModule?.headers !== undefined;
  /* Nothing to show at all (non-email, no envelope data) — hide the whole panel. */
  const hasEnvelope =
    hasCollapsible || (isPush && activePush !== undefined) || (isChat && activeChat !== undefined);

  return (
    <div className="flex flex-1">
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
                {hasCollapsible && (
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
                )}
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

                  {/* The push "envelope" is the content itself: title and body, edited here, shown below. */}
                  {isPush && activePush !== undefined && (
                    <>
                      <Field label={t('emails.contentTitle')}>
                        {saveField ? (
                          <EditableText
                            value={activePush.title}
                            noneLabel={t('common.none')}
                            onSave={saveField('title')}
                          />
                        ) : (
                          (activePush.title ?? t('common.none'))
                        )}
                      </Field>
                      <Field label={t('emails.contentBody')}>
                        {saveField ? (
                          <EditableText
                            value={activePush.body}
                            noneLabel={t('common.none')}
                            onSave={saveField('body')}
                          />
                        ) : (
                          (activePush.body ?? t('common.none'))
                        )}
                      </Field>
                    </>
                  )}

                  {/* A chat message's "envelope" is its destination and the two strings that carry it. */}
                  {isChat && activeChat !== undefined && (
                    <>
                      {activeChat.to !== undefined && (
                        <Field label={t('emails.channel')}>{activeChat.to}</Field>
                      )}
                      <Field label={t('emails.contentTitle')}>
                        {saveField ? (
                          <EditableText
                            value={activeChat.title}
                            noneLabel={t('common.none')}
                            onSave={saveField('title')}
                          />
                        ) : (
                          (activeChat.title ?? t('common.none'))
                        )}
                      </Field>
                      <Field label={t('emails.contentBody')}>
                        {saveField ? (
                          <EditableText
                            value={activeChat.body}
                            noneLabel={t('common.none')}
                            onSave={saveField('body')}
                          />
                        ) : (
                          (activeChat.body ?? t('common.none'))
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
              className="relative flex flex-1 flex-col"
              style={{
                backgroundColor: scheme === 'dark' ? '#000' : 'var(--color-gray-50)',
                /* 0.5px radius: react-flow draws its dots at r=0.5 for zoom 1. */
                backgroundImage: `radial-gradient(${
                  scheme === 'dark' ? 'var(--color-gray-700)' : 'var(--color-gray-400)'
                } 0.5px, transparent 0.5px)`,
                backgroundSize: '16px 16px',
              }}
            >
              {/* The stage grows with the email and the page scrolls it (see
                  __root); the toolbar below rides along as `sticky`. */}
              <div className="flex-1 p-6 pb-4">
                {isChat ? (
                  activeChat === undefined ? (
                    <div
                      className="border-border bg-card mx-auto max-w-xl rounded-2xl border border-dashed p-8 text-center"
                      style={superellipse}
                    >
                      <p className="text-primary text-sm font-medium">
                        {t('emails.notRegistered')}
                      </p>
                      <p className="text-muted mt-2 text-sm">
                        {t('emails.chatNotRegisteredHint', {
                          key: active.key,
                          registry: active.channel,
                        })}
                      </p>
                    </div>
                  ) : isSlack ? (
                    <SlackPreview
                      sender={activeChat.sender ?? appName ?? 'App'}
                      to={activeChat.to}
                      title={activeChat.title}
                      body={activeChat.body ?? ''}
                      scheme={scheme}
                      zoom={zoom}
                    />
                  ) : (
                    <DiscordPreview
                      sender={activeChat.sender ?? appName ?? 'App'}
                      to={activeChat.to}
                      title={activeChat.title}
                      body={activeChat.body ?? ''}
                      scheme={scheme}
                      zoom={zoom}
                    />
                  )
                ) : isPush ? (
                  activePush === undefined ? (
                    <div
                      className="border-border bg-card mx-auto max-w-xl rounded-2xl border border-dashed p-8 text-center"
                      style={superellipse}
                    >
                      <p className="text-primary text-sm font-medium">
                        {t('emails.notRegistered')}
                      </p>
                      <p className="text-muted mt-2 text-sm">
                        {t('emails.pushNotRegisteredHint', { key: active.key })}
                      </p>
                    </div>
                  ) : (
                    <PushPreview
                      appName={appName ?? 'App'}
                      title={activePush.title ?? activePush.name ?? active.key}
                      body={activePush.body ?? ''}
                      scheme={scheme}
                      zoom={zoom}
                    />
                  )
                ) : activeModule === undefined ? (
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
                    srcDoc={`${html ?? ''}${NO_SCROLL}${scheme === 'dark' ? DARK_SIMULATION : ''}`}
                    /*
                     * Sized to its document rather than the pane, so long emails
                     * scroll in the outer container — which can pad past the
                     * floating toolbar; an iframe scrolling internally cannot.
                     */
                    onLoad={(event) => {
                      const frame = event.currentTarget;
                      const root = frame.contentDocument?.documentElement ?? undefined;
                      if (root === undefined) return;
                      /* getBoundingClientRect keeps the fraction scrollHeight rounds off; ceil it. */
                      const height = Math.ceil(root.getBoundingClientRect().height);
                      if (height > 0) frame.style.height = `${height}px`;
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

              {/*
                Floating preview toolbar: client scheme, device width, zoom.
                Sticky rather than absolute — the stage is no longer a fixed
                frame, so anchoring to its bottom would park the toolbar at the
                end of a long email instead of keeping it to hand. The wrapper
                spans the stage and must not swallow clicks meant for it.
              */}
              {(isChat
                ? activeChat !== undefined
                : isPush
                  ? activePush !== undefined
                  : activeModule !== undefined && !loading && error === undefined) && (
                <div className="pointer-events-none sticky bottom-0 z-10 flex justify-center pt-2 pb-4">
                  <div className="border-border bg-card pointer-events-auto flex items-center gap-0.5 rounded-full border p-1 shadow-lg">
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
                    {/* Device widths are an email concern; a push shows both platforms, a chat message its client. */}
                    {!isPush && !isChat && (
                      <>
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
                      </>
                    )}
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
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
