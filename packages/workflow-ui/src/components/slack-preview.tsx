import type { SlackContent } from '@shware/workflow';
import { useTranslation } from 'react-i18next';
import { ChatMarkup } from './chat-markup';
import { superellipse } from './corner-shape';

/**
 * An incoming-webhook message as Slack draws it in a channel: the app's name and icon with the
 * APP tag, then its Block Kit blocks (header, section with fields and accessory, divider,
 * context, actions, image) — or the plain `text` when there are none, which is also what
 * notifications show. Slack's palette for each theme; close enough to judge the message.
 */
export interface SlackPreviewProps {
  message: SlackContent;
  /** The name the app posts under when the message names none: the project title upstream. */
  appName: string;
  scheme: 'light' | 'dark';
  zoom: number;
}

const PALETTE = {
  dark: { bg: '#1a1d21', text: '#d1d2d3', muted: '#ababad', name: '#ffffff', border: '#35373b' },
  light: { bg: '#ffffff', text: '#1d1c1d', muted: '#616061', name: '#1d1c1d', border: '#dddddd' },
};

/** A Block Kit text object: plain text, or mrkdwn formatted. */
interface TextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
}

type Element = Record<string, unknown> & { type: string };

const textOf = (value: unknown): TextObject | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const object = value as Partial<TextObject>;
  return typeof object.text === 'string' ? (object as TextObject) : undefined;
};

const linkClass = 'text-[#1d9bd1] hover:underline';
const Text = ({ value, className }: { value: TextObject | undefined; className?: string }) =>
  value === undefined ? null : (
    <div className={`break-words whitespace-pre-wrap ${className ?? ''}`}>
      {value.type === 'mrkdwn' ? (
        <ChatMarkup text={value.text} dialect="slack" linkClass={linkClass} />
      ) : (
        value.text
      )}
    </div>
  );
const Button = ({ element, colors }: { element: Element; colors: (typeof PALETTE)['light'] }) => {
  const style = element.style as string | undefined;
  return (
    <span
      className="inline-flex h-8 items-center rounded-lg border px-3 text-[13px] font-bold"
      style={
        style === 'primary'
          ? { background: '#007a5a', borderColor: '#007a5a', color: '#fff' }
          : style === 'danger'
            ? { background: '#e01e5a', borderColor: '#e01e5a', color: '#fff' }
            : { borderColor: colors.border, color: colors.name }
      }
    >
      {textOf(element.text)?.text}
    </span>
  );
};

export function SlackPreview({ message, appName, scheme, zoom }: SlackPreviewProps) {
  const { t } = useTranslation();
  const colors = PALETTE[scheme];
  const name = message.username ?? appName;

  const blocks = (message.blocks ?? []) as Element[];
  return (
    <div
      className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border shadow-sm"
      style={{
        ...superellipse,
        background: colors.bg,
        borderColor: colors.border,
        transform: `scale(${zoom})`,
        transformOrigin: 'top center',
      }}
    >
      <div
        className="flex gap-2 px-5 py-4 text-[15px] leading-[1.46668]"
        style={{ color: colors.text }}
      >
        {message.icon_url ? (
          <img src={message.icon_url} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#4a154b] text-sm font-bold text-white">
            {message.icon_emoji === undefined ? name.slice(0, 1).toUpperCase() : '🙂'}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-black" style={{ color: colors.name }}>
              {name}
            </span>
            <span
              className="rounded-[3px] px-1 text-[10px] font-bold"
              style={{ background: scheme === 'dark' ? '#35373b' : '#e8e8e8', color: colors.muted }}
            >
              APP
            </span>
            <span className="text-xs" style={{ color: colors.muted }}>
              {t('emails.chatNow')}
            </span>
          </div>
          {blocks.length === 0 ? (
            <Text
              value={{
                type: message.mrkdwn === false ? 'plain_text' : 'mrkdwn',
                text: message.text,
              }}
            />
          ) : (
            blocks.map((block, index) => {
              // oxlint-disable-next-line react/no-array-index-key -- blocks are positional
              const key = index;
              switch (block.type) {
                case 'header':
                  return (
                    <div
                      key={key}
                      className="mt-1 text-lg font-black"
                      style={{ color: colors.name }}
                    >
                      {textOf(block.text)?.text}
                    </div>
                  );
                case 'divider':
                  return <hr key={key} className="my-2" style={{ borderColor: colors.border }} />;
                case 'section': {
                  const fields = (block.fields as unknown[] | undefined) ?? [];
                  const accessory = block.accessory as Element | undefined;
                  return (
                    <div key={key} className="flex gap-3">
                      <div className="min-w-0 flex-1">
                        <Text value={textOf(block.text)} />
                        {fields.length > 0 && (
                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                            {fields.map((field, i) => (
                              // oxlint-disable-next-line react/no-array-index-key -- fields are positional
                              <Text key={i} value={textOf(field)} />
                            ))}
                          </div>
                        )}
                      </div>
                      {accessory?.type === 'image' && (
                        <img
                          src={accessory.image_url as string}
                          alt={(accessory.alt_text as string | undefined) ?? ''}
                          className="size-[88px] shrink-0 rounded-lg object-cover"
                        />
                      )}
                      {accessory?.type === 'button' && (
                        <Button element={accessory} colors={colors} />
                      )}
                    </div>
                  );
                }
                case 'context':
                  return (
                    <div
                      key={key}
                      className="flex flex-wrap items-center gap-1.5 text-xs"
                      style={{ color: colors.muted }}
                    >
                      {((block.elements as Element[] | undefined) ?? []).map((element, i) =>
                        element.type === 'image' ? (
                          // oxlint-disable-next-line react/no-array-index-key -- elements are positional
                          <img
                            key={i}
                            src={element.image_url as string}
                            alt=""
                            className="size-4 rounded"
                          />
                        ) : (
                          // oxlint-disable-next-line react/no-array-index-key -- elements are positional
                          <Text key={i} value={textOf(element)} />
                        )
                      )}
                    </div>
                  );
                case 'actions':
                  return (
                    <div key={key} className="mt-1 flex flex-wrap gap-2">
                      {((block.elements as Element[] | undefined) ?? []).map((element, i) =>
                        element.type === 'button' ? (
                          // oxlint-disable-next-line react/no-array-index-key -- elements are positional
                          <Button key={i} element={element} colors={colors} />
                        ) : null
                      )}
                    </div>
                  );
                case 'image':
                  return (
                    <figure key={key} className="mt-1">
                      {textOf(block.title) !== undefined && (
                        <figcaption className="mb-1 text-sm" style={{ color: colors.muted }}>
                          {textOf(block.title)?.text}
                        </figcaption>
                      )}
                      <img
                        src={block.image_url as string}
                        alt={(block.alt_text as string | undefined) ?? ''}
                        className="max-h-[300px] rounded-lg object-contain"
                      />
                    </figure>
                  );
                default:
                  return (
                    <div key={key} className="text-xs italic" style={{ color: colors.muted }}>
                      {t('emails.slackBlockUnsupported', { type: block.type })}
                    </div>
                  );
              }
            })
          )}
        </div>
      </div>
    </div>
  );
}
