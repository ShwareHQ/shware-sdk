import { Hash, Plus, Smile, SmilePlus, Sticker } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Slack and Discord previews: one message, in its client's own chrome.
 *
 * Same problem as the push banner — a chat message has no document of its own,
 * so the preview has to *draw* the surface the text lands on. And it has to
 * draw two of them, because the whole point of picking Slack over Discord is
 * that they read differently: Slack is a tidy workplace list (square-ish
 * avatar, name then a small timestamp, black-on-white), Discord is a dark
 * lounge (round avatar, coloured name, "Today at" timestamp). A generic grey
 * bubble would preview neither.
 *
 * Colours below are the vendors' own, hard-coded on purpose and exempt from
 * the semantic-token rule for the same reason the device mockups are: this box
 * is a reproduction of somebody else's product surface, not studio chrome, and
 * re-theming it would defeat the preview.
 */
export interface ChatPreviewProps {
  /** Bot display name on the message; falls back to the project title upstream. */
  sender: string;
  /** Destination, e.g. `#customer-success`; the channel header is hidden without it. */
  to?: string | undefined;
  /** Bold first line. Shown verbatim, `{prop}` placeholders included. */
  title?: string | undefined;
  body: string;
  scheme: 'light' | 'dark';
  zoom: number;
}

/** The keynote clock, shared with the device mockups so every preview agrees. */
const CLOCK = '9:41 AM';
/** Rendered surface width — a comfortable reading column, not a real window. */
const SURFACE_W = 560;

/** Strip a leading `#`: both clients draw the hash as a glyph, not as text. */
const channelName = (to: string): string => to.replace(/^#/, '');

/**
 * Avatar stand-in: the sender's initial on the studio's gradient. Radius is the
 * client's — Slack's rounded square, Discord's circle.
 */
function Avatar({ name, size, radius }: { name: string; size: number; radius: number }) {
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center font-semibold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: size * 0.46,
        background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 55%,#d946ef 100%)',
      }}
    >
      {(name.trim().charAt(0) || 'A').toUpperCase()}
    </div>
  );
}

/**
 * The client window: labelled like the device mockups, a rounded surface with
 * a channel header and the message under it. `zoom` scales the whole thing,
 * matching how the push preview handles the toolbar's zoom.
 */
function Surface({
  label,
  labelColor,
  background,
  border,
  header,
  children,
}: {
  label: string;
  labelColor: string;
  background: string;
  border: string;
  header: ReactNode;
  children: ReactNode;
}) {
  const shadow: CSSProperties = { boxShadow: '0 20px 40px rgba(15,23,42,0.18)' };
  return (
    <div style={{ width: SURFACE_W }}>
      <div className="mb-3 text-center text-[14px] font-semibold" style={{ color: labelColor }}>
        {label}
      </div>
      <div
        className="overflow-hidden rounded-[12px]"
        style={{ background, border: `1px solid ${border}`, ...shadow }}
      >
        {header}
        {children}
      </div>
    </div>
  );
}

/**
 * Slack, to its own design: 36px rounded-square avatar, bold 15px name with
 * the `APP` badge every bot carries, a small timestamp after it, and the body
 * on the following lines. Lato is Slack's UI face; the fallbacks cover every
 * machine that does not have it.
 */
export function SlackPreview({ sender, to, title, body, scheme, zoom }: ChatPreviewProps) {
  const dark = scheme === 'dark';
  /* Aubergine sidebar aside, a Slack message list is white / #1A1D21. */
  const bg = dark ? '#1A1D21' : '#FFFFFF';
  const primary = dark ? '#D1D2D3' : '#1D1C1D';
  const muted = dark ? '#ABABAD' : '#616061';
  const rule = dark ? '#35373B' : '#E2E2E2';
  const face: CSSProperties = { fontFamily: "Lato, 'Slack-Lato', Helvetica, Arial, sans-serif" };
  return (
    <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
      <Surface
        label="Slack"
        labelColor={dark ? 'var(--color-gray-400)' : 'var(--color-gray-500)'}
        background={bg}
        border={rule}
        header={
          to === undefined ? null : (
            <div
              className="flex items-center gap-[6px] px-[16px] py-[12px] text-[15px] font-bold"
              style={{ ...face, color: primary, borderBottom: `1px solid ${rule}` }}
            >
              <Hash size={15} strokeWidth={3} aria-hidden style={{ color: muted }} />
              {channelName(to)}
            </div>
          )
        }
      >
        <div className="flex gap-[8px] px-[16px] py-[10px]" style={face}>
          <Avatar name={sender} size={36} radius={4} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-[6px]">
              <span className="text-[15px] leading-[22px] font-black" style={{ color: primary }}>
                {sender}
              </span>
              {/* Every non-human poster wears this badge; without it the preview lies. */}
              <span
                className="rounded-[2px] px-[4px] text-[10px] leading-[15px] font-bold"
                style={{
                  background: dark ? '#35373B' : '#E8E8E8',
                  color: dark ? '#ABABAD' : '#616061',
                }}
              >
                APP
              </span>
              <span className="text-[12px] leading-[22px]" style={{ color: muted }}>
                {CLOCK}
              </span>
            </div>
            {title !== undefined && title !== '' && (
              <div
                className="text-[15px] leading-[22px] font-bold break-words"
                style={{ color: primary }}
              >
                {title}
              </div>
            )}
            <div className="text-[15px] leading-[22px] break-words" style={{ color: primary }}>
              {body}
            </div>
            {/* The reaction affordance under a message — small, but it is what says "Slack". */}
            <div className="mt-[6px] flex gap-[4px]">
              <span
                className="flex h-[24px] w-[36px] items-center justify-center rounded-[12px]"
                style={{ border: `1px solid ${rule}`, color: muted }}
              >
                <SmilePlus size={14} strokeWidth={2} aria-hidden />
              </span>
            </div>
          </div>
        </div>
      </Surface>
    </div>
  );
}

/**
 * Discord, to its own design: 40px circular avatar, the username in a member
 * colour with the blurple `BOT` tag, a "Today at" timestamp, and 16px body
 * text. Discord's own face is gg sans, which nobody has installed — the
 * fallback chain is the one Discord itself ships.
 */
export function DiscordPreview({ sender, to, title, body, scheme, zoom }: ChatPreviewProps) {
  const dark = scheme === 'dark';
  /* Discord's two themes: #313338 dark, #FFFFFF light. */
  const bg = dark ? '#313338' : '#FFFFFF';
  const primary = dark ? '#DBDEE1' : '#313338';
  const muted = dark ? '#949BA4' : '#5C5E66';
  const rule = dark ? '#26282C' : '#E3E5E8';
  /* Blurple: the BOT tag and the name of anything posting through a webhook. */
  const blurple = '#5865F2';
  const face: CSSProperties = {
    fontFamily: "'gg sans', 'Noto Sans', Helvetica, Arial, sans-serif",
  };
  return (
    <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
      <Surface
        label="Discord"
        labelColor={dark ? 'var(--color-gray-400)' : 'var(--color-gray-500)'}
        background={bg}
        border={rule}
        header={
          to === undefined ? null : (
            <div
              className="flex items-center gap-[8px] px-[16px] py-[12px] text-[16px] font-semibold"
              style={{ ...face, color: primary, borderBottom: `1px solid ${rule}` }}
            >
              <Hash size={20} strokeWidth={2.5} aria-hidden style={{ color: muted }} />
              {channelName(to)}
            </div>
          )
        }
      >
        <div className="flex gap-[16px] px-[16px] py-[10px]" style={face}>
          <Avatar name={sender} size={40} radius={20} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-[8px]">
              <span
                className="text-[16px] leading-[22px] font-medium"
                style={{ color: dark ? '#F2F3F5' : '#060607' }}
              >
                {sender}
              </span>
              <span
                className="rounded-[3px] px-[4px] text-[10px] leading-[15px] font-semibold text-white"
                style={{ background: blurple }}
              >
                BOT
              </span>
              <span className="text-[12px] leading-[22px]" style={{ color: muted }}>
                Today at {CLOCK}
              </span>
            </div>
            {title !== undefined && title !== '' && (
              <div
                className="text-[16px] leading-[22px] font-bold break-words"
                style={{ color: primary }}
              >
                {title}
              </div>
            )}
            <div className="text-[16px] leading-[22px] break-words" style={{ color: primary }}>
              {body}
            </div>
          </div>
        </div>
        {/* The message box: the bottom of every Discord channel, and the frame's floor. */}
        <div className="px-[16px] pt-[2px] pb-[16px]" style={face}>
          <div
            className="flex items-center gap-[12px] rounded-[8px] px-[16px] py-[11px] text-[16px]"
            style={{ background: dark ? '#383A40' : '#EBEDEF', color: muted }}
          >
            <Plus size={18} strokeWidth={2.5} aria-hidden />
            <span className="flex-1">
              Message #{to === undefined ? 'channel' : channelName(to)}
            </span>
            <Sticker size={18} strokeWidth={2} aria-hidden />
            <Smile size={18} strokeWidth={2} aria-hidden />
          </div>
        </div>
      </Surface>
    </div>
  );
}
