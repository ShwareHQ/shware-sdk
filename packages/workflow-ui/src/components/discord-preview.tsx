import type { DiscordContent } from '@shware/workflow';
import { useTranslation } from 'react-i18next';
import { ChatMarkup } from './chat-markup';
import { superellipse } from './corner-shape';

/**
 * A webhook message as Discord draws it in a channel: the webhook's name and avatar with the APP
 * tag, the content, and every embed (accent bar, author, title, description, fields, image,
 * thumbnail, footer). Discord's own palette for each theme; close enough to judge the message,
 * not a pixel copy.
 */
export interface DiscordPreviewProps {
  message: DiscordContent;
  /** The name a webhook posts under when the message names none: the project title upstream. */
  appName: string;
  scheme: 'light' | 'dark';
  zoom: number;
}

const PALETTE = {
  dark: { bg: '#313338', text: '#dbdee1', muted: '#949ba4', name: '#f2f3f5', embed: '#2b2d31' },
  light: { bg: '#ffffff', text: '#313338', muted: '#5c5e66', name: '#060607', embed: '#f2f3f5' },
};

const hex = (color: number | null | undefined) =>
  color === undefined || color === null ? '#1e1f22' : `#${color.toString(16).padStart(6, '0')}`;

export function DiscordPreview({ message, appName, scheme, zoom }: DiscordPreviewProps) {
  const { t } = useTranslation();
  const colors = PALETTE[scheme];
  const name = message.username ?? appName;
  const linkClass = 'text-[#00a8fc] hover:underline';
  return (
    <div
      className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl shadow-sm"
      style={{
        ...superellipse,
        background: colors.bg,
        transform: `scale(${zoom})`,
        transformOrigin: 'top center',
      }}
    >
      <div className="flex gap-4 px-4 py-4" style={{ color: colors.text }}>
        {message.avatar_url ? (
          <img
            src={message.avatar_url}
            alt=""
            className="size-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#5865f2] text-sm font-semibold text-white">
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 text-[15px] leading-[1.375]">
          <div className="flex items-center gap-1.5">
            <span className="font-medium" style={{ color: colors.name }}>
              {name}
            </span>
            <span className="rounded-[3px] bg-[#5865f2] px-1 text-[10px] leading-4 font-semibold text-white">
              APP
            </span>
            <span className="text-xs" style={{ color: colors.muted }}>
              {t('emails.chatNow')}
            </span>
          </div>
          {message.content !== undefined && message.content !== '' && (
            <div className="break-words whitespace-pre-wrap">
              <ChatMarkup text={message.content} dialect="discord" linkClass={linkClass} />
            </div>
          )}
          {(message.embeds ?? []).map((embed, index) => (
            <div
              // oxlint-disable-next-line react/no-array-index-key -- embeds are positional
              key={index}
              className="mt-1.5 grid max-w-[516px] grid-cols-[1fr_auto] gap-x-4 rounded-[4px] border-l-4 py-2 pr-4 pl-3"
              style={{ borderLeftColor: hex(embed.color), background: colors.embed }}
            >
              <div className="min-w-0">
                {embed.author !== undefined && (
                  <div
                    className="mt-1 flex items-center gap-2 text-sm font-semibold"
                    style={{ color: colors.name }}
                  >
                    {embed.author.icon_url !== undefined && (
                      <img src={embed.author.icon_url} alt="" className="size-6 rounded-full" />
                    )}
                    {embed.author.name}
                  </div>
                )}
                {embed.title !== undefined && (
                  <div
                    className="mt-1 font-semibold"
                    style={{ color: embed.url ? undefined : colors.name }}
                  >
                    {embed.url ? (
                      <a href={embed.url} target="_blank" rel="noreferrer" className={linkClass}>
                        {embed.title}
                      </a>
                    ) : (
                      embed.title
                    )}
                  </div>
                )}
                {embed.description !== undefined && (
                  <div className="mt-1 text-sm break-words whitespace-pre-wrap">
                    <ChatMarkup text={embed.description} dialect="discord" linkClass={linkClass} />
                  </div>
                )}
                {(embed.fields ?? []).length > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(embed.fields ?? []).map((field, i) => (
                      <div
                        // oxlint-disable-next-line react/no-array-index-key -- fields are positional
                        key={i}
                        className={field.inline ? 'col-span-1' : 'col-span-3'}
                      >
                        <div className="text-sm font-semibold" style={{ color: colors.name }}>
                          {field.name}
                        </div>
                        <div className="text-sm whitespace-pre-wrap">
                          <ChatMarkup text={field.value} dialect="discord" linkClass={linkClass} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {embed.image?.url !== undefined && (
                  <img
                    src={embed.image.url}
                    alt=""
                    className="mt-4 max-h-[300px] rounded-[4px] object-contain"
                  />
                )}
                {(embed.footer !== undefined || embed.timestamp !== undefined) && (
                  <div
                    className="mt-2 flex items-center gap-2 text-xs"
                    style={{ color: colors.muted }}
                  >
                    {embed.footer?.icon_url !== undefined && (
                      <img src={embed.footer.icon_url} alt="" className="size-5 rounded-full" />
                    )}
                    {[
                      embed.footer?.text,
                      embed.timestamp && new Date(embed.timestamp).toLocaleString(),
                    ]
                      .filter(Boolean)
                      .join(' • ')}
                  </div>
                )}
              </div>
              {embed.thumbnail?.url !== undefined && (
                <img
                  src={embed.thumbnail.url}
                  alt=""
                  className="mt-2 size-20 rounded-[4px] object-cover"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
