import type { ReactNode } from 'react';

/**
 * The inline formatting chat clients render, drawn as React nodes (never HTML strings): Discord's
 * markdown (`**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `` `code` ``, `[text](url)`)
 * and Slack's mrkdwn (`*bold*`, `_italic_`, `~strike~`, `` `code` ``, `<url|text>`). Enough to
 * preview a message faithfully, not a full parser: nesting is one level deep. Underscore (and
 * Slack's `*` / `~`) markers only open and close at word boundaries, so `snake_case_name` stays text.
 */
export type Dialect = 'discord' | 'slack';

interface Rule {
  pattern: RegExp;
  render: (match: RegExpExecArray, key: string, linkClass: string) => ReactNode;
}

const code = (text: string, key: string) => (
  <code
    key={key}
    className="rounded bg-black/10 px-1 py-px font-mono text-[0.85em] dark:bg-white/10"
  >
    {text}
  </code>
);

const link = (href: string, text: string, key: string, className: string) => (
  <a key={key} href={href} target="_blank" rel="noreferrer" className={className}>
    {text}
  </a>
);

const RULES: Record<Dialect, Rule[]> = {
  discord: [
    { pattern: /`([^`]+)`/, render: (m, key) => code(m[1], key) },
    {
      pattern: /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/,
      render: (m, key, linkClass) => link(m[2], m[1], key, linkClass),
    },
    { pattern: /\*\*([^*]+)\*\*/, render: (m, key) => <strong key={key}>{m[1]}</strong> },
    { pattern: /(?<!\w)__([^_]+)__(?!\w)/, render: (m, key) => <u key={key}>{m[1]}</u> },
    { pattern: /~~([^~]+)~~/, render: (m, key) => <s key={key}>{m[1]}</s> },
    {
      pattern: /\*([^*]+)\*|(?<!\w)_([^_]+)_(?!\w)/,
      render: (m, key) => <em key={key}>{m.at(1) ?? m.at(2)}</em>,
    },
    {
      pattern: /(https?:\/\/[^\s<]+)/,
      render: (m, key, linkClass) => link(m[1], m[1], key, linkClass),
    },
  ],
  slack: [
    { pattern: /`([^`]+)`/, render: (m, key) => code(m[1], key) },
    {
      pattern: /<((?:https?:\/\/|mailto:|tel:)[^|>]+)(?:\|([^>]+))?>/,
      render: (m, key, linkClass) => link(m[1], m.at(2) ?? m[1], key, linkClass),
    },
    { pattern: /(?<!\w)\*([^*]+)\*(?!\w)/, render: (m, key) => <strong key={key}>{m[1]}</strong> },
    { pattern: /(?<!\w)_([^_]+)_(?!\w)/, render: (m, key) => <em key={key}>{m[1]}</em> },
    { pattern: /(?<!\w)~([^~]+)~(?!\w)/, render: (m, key) => <s key={key}>{m[1]}</s> },
  ],
};

function inline(text: string, dialect: Dialect, linkClass: string, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let index = 0;
  while (rest !== '') {
    // The earliest match of any rule wins; ties go to the rule listed first
    let best: { match: RegExpExecArray; rule: Rule } | undefined;
    for (const rule of RULES[dialect]) {
      const match = rule.pattern.exec(rest);
      if (match !== null && (best === undefined || match.index < best.match.index)) {
        best = { match, rule };
      }
    }
    if (best === undefined) {
      out.push(rest);
      break;
    }
    if (best.match.index > 0) out.push(rest.slice(0, best.match.index));
    out.push(best.rule.render(best.match, `${prefix}${index++}`, linkClass));
    rest = rest.slice(best.match.index + best.match[0].length);
  }
  return out;
}

/** Lines kept as lines; each formatted inline. */
export function ChatMarkup({
  text,
  dialect,
  linkClass,
}: {
  text: string;
  dialect: Dialect;
  linkClass: string;
}) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- lines have no identity but their place
        <span key={i}>
          {inline(line, dialect, linkClass, `${i}-`)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}
