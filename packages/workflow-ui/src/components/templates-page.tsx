import {
  type DiscordTemplate,
  type EmailConfig,
  type EmailTemplate,
  type PushTemplate,
  type SlackTemplate,
  formatEmailAddress,
  resolveEmail,
} from '@shware/workflow';
import { Minus, Monitor, Moon, Plus, Smartphone, Sun } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';
import {
  type Props,
  type TemplateFailure,
  previewPropsOf,
  resolveDiscord,
  resolvePush,
  resolveSlack,
} from '../utils/template-content';
import { superellipse } from './corner-shape';
import { DiscordPreview } from './discord-preview';
import { DARK_SIMULATION } from './email-thumbnail';
import { PushPreview } from './push-preview';
import { SlackPreview } from './slack-preview';
import type { TemplateRefInfo } from './template-refs';
import { Textarea } from './textarea';

/**
 * Template preview page: the list on the left comes from IR, the react-email
 * component renders on the right. The email render is the caller's (it owns
 * the query); exactly one of `html` and `failure` describes this render.
 */
export interface TemplatePreview {
  html?: string;
  subject?: string;
  /** The template refused its props, or failed to render — field paths included. */
  failure?: TemplateFailure;
  /** Anything else that stopped the render. */
  error?: string;
  loading: boolean;
}

export type { TemplateFailure } from '../utils/template-content';

export interface TemplatesPageProps {
  refs: TemplateRefInfo[];
  /** The project's email registry; keys match the DSL's template keys. */
  emails: Record<string, EmailTemplate | undefined>;
  /** The project's push registry, same contract as `emails` for the push channel. */
  pushes?: Record<string, PushTemplate | undefined>;
  /** The project's Discord and Slack webhook registries. */
  discords?: Record<string, DiscordTemplate | undefined>;
  slacks?: Record<string, SlackTemplate | undefined>;
  /** App identity on the push mockups; defaults to the project title upstream. */
  appName?: string;
  selected: string | undefined;
  /**
   * Channel of the selected template. One key can be registered in more than
   * one registry (an email and a push both called `checkout_reminder`), so the
   * key alone does not say which one is meant; absent picks the first match.
   */
  selectedChannel?: string | undefined;
  /** Rendered output for the selected template, produced by the caller. */
  preview: TemplatePreview;
  /** The config's `email`: an email template's unsubscribe link falls back to its default. */
  emailConfig?: EmailConfig;
  /**
   * In-memory props override for the selected template's preview; absent
   * renders the template's own `preview`. Never written anywhere.
   */
  previewProps?: Props | undefined;
  /**
   * Called as the props editor changes (undefined: back to the template's
   * `preview`). The editor only appears when this is provided.
   */
  onPreviewPropsChange?: (props: Props | undefined) => void;
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
      <dt className="whitespace-nowrap text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-secondary">{children}</dd>
    </>
  );
}

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
/** A refused render: which phase, then every failing field path with its message. */
export function TemplateFailurePanel({ failure }: { failure: TemplateFailure }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300"
      style={superellipse}
    >
      <p className="font-medium">{t(`emails.failure.${failure.phase}`)}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {failure.issues.map((issue, index) => (
          <li key={`${issue.path}:${index}`}>
            {issue.path !== '' && <code className="mr-2 font-mono">{issue.path}</code>}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The preview props as JSON, editable in memory. Text that is not a JSON
 * object is reported here and handed up as a failure, so the preview never
 * goes on showing the last good render as if it were this one.
 */
function PreviewPropsEditor({
  initial,
  onChange,
  onInvalid,
  onReset,
}: {
  initial: Props;
  onChange: (props: Props) => void;
  onInvalid: (message: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  /*
   * The text is the user's once they type, and derived from `initial` until
   * then — so an HMR change to the template's `preview` still shows here, and
   * the component never remounts mid-edit (a remount loses the caret).
   */
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const text = draft ?? JSON.stringify(initial, null, 2);
  return (
    <div className="border-b border-border bg-card px-6 py-4">
      <div className="flex items-center justify-between">
        <label htmlFor="preview-props" className="text-sm text-muted">
          {t('emails.previewProps')}
        </label>
        <button
          type="button"
          onClick={() => {
            setDraft(undefined);
            onReset();
          }}
          className="text-xs text-muted transition-colors hover:text-primary"
        >
          {t('emails.previewPropsReset')}
        </button>
      </div>
      <Textarea
        id="preview-props"
        size="sm"
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        spellCheck={false}
        className="mt-2 w-full font-mono text-xs"
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          let parsed: unknown;
          try {
            parsed = JSON.parse(next);
          } catch (error) {
            onInvalid(error instanceof Error ? error.message : String(error));
            return;
          }
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            onInvalid(t('emails.previewPropsNotObject'));
            return;
          }
          onChange(parsed as Props);
        }}
      />
      <p className="mt-1.5 text-xs text-muted">{t('emails.previewPropsHint')}</p>
    </div>
  );
}

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

export function TemplatesPage({
  refs,
  emails,
  pushes = {},
  discords = {},
  slacks = {},
  appName,
  selected,
  selectedChannel,
  preview,
  emailConfig,
  previewProps,
  onPreviewPropsChange,
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
  /* Exactly the template asked for: an unknown key says so rather than showing another's content. */
  const active = refs.find(
    (ref) =>
      ref.key === selected && (selectedChannel === undefined || ref.channel === selectedChannel)
  );
  /* Editor text that is not a JSON object: shown in place of any render. */
  const [jsonError, setJsonError] = useState<{ for: string; message: string } | undefined>();
  /* Each channel reads its own registry, so a push key never shadows an email one. */
  const isPush = active?.channel === 'push';
  const isEmail = active?.channel === 'email';
  const activeEmail = active !== undefined && isEmail ? emails[active.key] : undefined;
  /* What this template is sent with: its own sender, the unsubscribe link resolved like a send's. */
  const resolved = activeEmail === undefined ? undefined : resolveEmail(activeEmail, emailConfig);
  const activePush = active !== undefined && isPush ? pushes[active.key] : undefined;
  const isDiscord = active?.channel === 'discord';
  const isSlack = active?.channel === 'slack';
  const isChat = isDiscord || isSlack;
  const activeDiscord = active !== undefined && isDiscord ? discords[active.key] : undefined;
  const activeSlack = active !== undefined && isSlack ? slacks[active.key] : undefined;
  const { html, subject, error, loading } = preview;
  const activeId = active === undefined ? '' : `${active.channel}:${active.key}`;
  /* Leaving a template drops its JSON error: coming back remounts the editor with fresh text. */
  if (jsonError !== undefined && jsonError.for !== activeId) setJsonError(undefined);
  const propsFailure: TemplateFailure | undefined =
    jsonError?.for === activeId
      ? { phase: 'json', issues: [{ path: '', message: jsonError.message }] }
      : undefined;
  /* Exactly one of these describes this render; a failure is never shown beside a success. */
  const failure = propsFailure ?? preview.failure;

  /*
   * The notification, from the same validated content a send uses — the props
   * override when there is one, the template's `preview` otherwise.
   */
  const pushResolution =
    active !== undefined && activePush !== undefined
      ? resolvePush(activePush, previewProps)
      : undefined;
  const push =
    propsFailure === undefined && pushResolution?.ok === true ? pushResolution.push : undefined;
  const pushFailure =
    propsFailure ?? (pushResolution?.ok === false ? pushResolution.failure : undefined);

  /* A chat message, from the same checked content a send posts. */
  const discordResolution =
    active !== undefined && activeDiscord !== undefined
      ? resolveDiscord(activeDiscord, previewProps)
      : undefined;
  const slackResolution =
    active !== undefined && activeSlack !== undefined
      ? resolveSlack(activeSlack, previewProps)
      : undefined;
  const chatResolution = discordResolution ?? slackResolution;
  const chatFailure =
    propsFailure ?? (chatResolution?.ok === false ? chatResolution.failure : undefined);
  const chatReady = propsFailure === undefined && chatResolution?.ok === true;

  const editedEntry = isPush
    ? activePush
    : isDiscord
      ? activeDiscord
      : isSlack
        ? activeSlack
        : activeEmail;

  return (
    <div className="flex flex-1">
      {/* Preview; the template list lives on the /emails index and the header dropdown. */}
      <section className="flex min-w-0 flex-1 flex-col bg-page">
        {active === undefined ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            {selected === undefined ? t('emails.empty') : t('emails.notFound', { key: selected })}
          </div>
        ) : (
          <>
            {/*
              The envelope: one face, one size, roomy rows — a read-only
              summary reads better as a calm table. Every email goes out with
              the project's envelope; a push's "envelope" is its content.
            */}
            {((isEmail && activeEmail !== undefined) || push !== undefined) && (
              <div className="border-b border-border bg-card px-6 py-4">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2.5 text-sm">
                  {isEmail && activeEmail !== undefined && resolved !== undefined && (
                    <>
                      <Field label={t('emails.from')}>{formatEmailAddress(resolved.from)}</Field>
                      {resolved.replyTo !== undefined && (
                        <Field label={t('emails.replyTo')}>
                          {formatEmailAddress(resolved.replyTo)}
                        </Field>
                      )}
                      <Field label={t('emails.subject')}>{subject ?? activeEmail.subject}</Field>
                      <Field label={t('emails.unsubscribeUrl')}>
                        {resolved.unsubscribeUrl ?? t('common.none')}
                      </Field>
                    </>
                  )}
                  {push !== undefined && (
                    <>
                      <Field label={t('emails.contentTitle')}>{push.title}</Field>
                      <Field label={t('emails.contentBody')}>{push.body}</Field>
                      {push.image !== undefined && (
                        <Field label={t('emails.contentImage')}>{push.image}</Field>
                      )}
                    </>
                  )}
                </dl>
              </div>
            )}

            {onPreviewPropsChange !== undefined && editedEntry !== undefined && (
              <PreviewPropsEditor
                /* A fresh editor per template only: the key must not change while someone types. */
                key={activeId}
                /* What the preview renders: the props handed in, else the template's own `preview`. */
                initial={previewProps ?? previewPropsOf(editedEntry)}
                onChange={(next) => {
                  setJsonError(undefined);
                  onPreviewPropsChange(next);
                }}
                onInvalid={(message) => setJsonError({ for: activeId, message })}
                onReset={() => {
                  setJsonError(undefined);
                  onPreviewPropsChange(undefined);
                }}
              />
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
                  (isDiscord ? activeDiscord : activeSlack) === undefined ? (
                    <div
                      className="mx-auto max-w-xl rounded-2xl border border-dashed border-border bg-card p-8 text-center"
                      style={superellipse}
                    >
                      <p className="text-sm font-medium text-primary">
                        {t('emails.notRegistered')}
                      </p>
                      <p className="mt-2 text-sm text-muted">
                        {t('emails.chatNotRegisteredHint', {
                          key: active.key,
                          channel: isDiscord ? 'discord' : 'slack',
                        })}
                      </p>
                    </div>
                  ) : chatFailure !== undefined ? (
                    <TemplateFailurePanel failure={chatFailure} />
                  ) : discordResolution?.ok === true ? (
                    <DiscordPreview
                      message={discordResolution.message}
                      appName={appName ?? 'App'}
                      scheme={scheme}
                      zoom={zoom}
                    />
                  ) : slackResolution?.ok === true ? (
                    <SlackPreview
                      message={slackResolution.message}
                      appName={appName ?? 'App'}
                      scheme={scheme}
                      zoom={zoom}
                    />
                  ) : null
                ) : isPush ? (
                  activePush === undefined ? (
                    <div
                      className="mx-auto max-w-xl rounded-2xl border border-dashed border-border bg-card p-8 text-center"
                      style={superellipse}
                    >
                      <p className="text-sm font-medium text-primary">
                        {t('emails.notRegistered')}
                      </p>
                      <p className="mt-2 text-sm text-muted">
                        {t('emails.pushNotRegisteredHint', { key: active.key })}
                      </p>
                    </div>
                  ) : pushFailure !== undefined ? (
                    <TemplateFailurePanel failure={pushFailure} />
                  ) : (
                    <PushPreview
                      appName={appName ?? 'App'}
                      title={push?.title ?? ''}
                      body={push?.body ?? ''}
                      scheme={scheme}
                      zoom={zoom}
                    />
                  )
                ) : activeEmail === undefined ? (
                  <div
                    className="mx-auto max-w-xl rounded-2xl border border-dashed border-border bg-card p-8 text-center"
                    style={superellipse}
                  >
                    <p className="text-sm font-medium text-primary">{t('emails.notRegistered')}</p>
                    <p className="mt-2 text-sm text-muted">
                      {t('emails.notRegisteredHint', { key: active.key })}
                    </p>
                  </div>
                ) : failure !== undefined ? (
                  <TemplateFailurePanel failure={failure} />
                ) : loading ? (
                  <div className="text-center text-sm text-muted">{t('emails.rendering')}</div>
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
                     * Same-origin so the document's height is readable below;
                     * no allow-scripts, so nothing in the email runs — a script
                     * in a template would otherwise run as the studio page and
                     * could read /__studio/stats. Same as the thumbnail.
                     */
                    sandbox="allow-same-origin"
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
                ? chatReady
                : isPush
                  ? push !== undefined
                  : activeEmail !== undefined &&
                    !loading &&
                    error === undefined &&
                    failure === undefined) && (
                <div className="pointer-events-none sticky bottom-0 z-10 flex justify-center pt-2 pb-4">
                  <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-lg">
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
                    {isEmail && (
                      <>
                        <div className="mx-1 h-4 w-px bg-border" />
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
                    <div className="mx-1 h-4 w-px bg-border" />
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
                      className="w-11 text-center text-xs font-medium text-secondary tabular-nums transition-colors hover:text-primary"
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
