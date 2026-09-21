import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ALL_CHANNELS_ICON, CHANNEL_ICON, channelIcon } from '../../components/channel-icon';
import { superellipse } from '../../components/corner-shape';
import {
  type DateRange,
  DateRangePicker,
  lastDays,
  parseIsoDay,
} from '../../components/date-range';
import { Dropdown, type DropdownOption } from '../../components/dropdown';
import { MetricCard, type MetricSeries, type Trend } from '../../components/metric-card';
import { findNode } from '../../components/template-refs';
import {
  type Granularity,
  METRIC_CHANNELS,
  type MessageStat,
  type MetricChannel,
  type MetricPoint,
} from '../../config';
import { lookup } from '../../utils/lookup';
import { workflowDetailRoute } from './workflows';

/** Sentinel for "no channel filter" — a `<select>` value cannot be undefined. */
const ALL = 'all';

/** Top N links; the card grows with its content, so the list has to stop somewhere. */
const LINK_LIMIT = 10;

const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];

const number = (value: number) => value.toLocaleString();
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const signed = (value: number, format: (value: number) => string) =>
  `${value > 0 ? '+' : ''}${format(value)}`;

/** A rate with no denominator is 0, not NaN — an empty bucket is still a bucket. */
const rate = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/** The share one funnel stage keeps of the one before it, ready to print. */
const share = (part: number, whole: number) => percent(rate(part, whole));

/**
 * Sent is its own denominator, so its rate is a foregone conclusion — but it
 * is printed anyway: without it the column's count sits a line higher than
 * every other column's, and a row stops reading as a row.
 */
const SENT_SHARE = '100%';

function trendOf(delta: number): Trend {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

const asChannel = (value: string): MetricChannel | undefined =>
  METRIC_CHANNELS.find((channel) => channel === value);

/* --------------------------------- Layout --------------------------------- */

/**
 * The shell every panel below the chart cards shares.
 *
 * A title and nothing else: the range lives in the toolbar that drives all of
 * these, and repeating it per panel only invited the two to disagree.
 */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-border bg-card mt-6 rounded-2xl border" style={superellipse}>
      <div className="border-border border-b px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/**
 * One funnel cell: the rate on top in grey, the absolute below it. The rate is
 * what you scan a column for and the count is what you check it against, so
 * neither can be the one you have to hover for.
 */
function FunnelCell({ rate, count }: { rate: string; count: number }) {
  return (
    <td className="border-border border-b px-4 py-3 align-top tabular-nums">
      <div className="text-muted text-xs">{rate}</div>
      <div className="text-sm">{number(count)}</div>
    </td>
  );
}

/* ------------------------------- Chart cards ------------------------------- */

const CARD_KEYS = ['sent', 'opened', 'clicked', 'converted'] as const;
type CardKey = (typeof CARD_KEYS)[number];

/**
 * Sent is a count; the other three are rates.
 *
 * Denominators follow the convention the message table uses, which is the
 * industry's: delivered against sent, everything after it against delivered.
 * Rates against `opened` (a click-to-open rate) read better in isolation but
 * stop being comparable across cards, and comparing them is the point of
 * putting the four side by side.
 */
const SERIES: Record<CardKey, (point: MetricPoint) => number> = {
  sent: (point) => point.sent,
  opened: (point) => rate(point.opened, point.delivered),
  clicked: (point) => rate(point.clicked, point.delivered),
  converted: (point) => rate(point.converted, point.delivered),
};

/** The two halves of a split metric, in the order they are plotted. */
type SplitKey = 'openedHuman' | 'openedMachine' | 'clickedHuman' | 'clickedMachine';

/**
 * Which cards decompose, and into what.
 *
 * Opens and clicks are the two the machines touch. Apple's Mail Privacy
 * Protection fetches the tracking pixel of everything it relays, Gmail's image
 * proxy caches it, and corporate scanners follow the links behind it — so both
 * numbers arrive inflated by traffic nobody caused, and an open rate that
 * doubled overnight usually means a client changed, not an audience. Sent is
 * ours to count and a conversion is a person doing something in the product,
 * so neither of those splits.
 *
 * Both halves are rated against the same denominator as their total, so the
 * three lines add up on screen exactly the way the counts do.
 */
const SPLIT: Record<CardKey, readonly [SplitKey, SplitKey] | undefined> = {
  sent: undefined,
  opened: ['openedHuman', 'openedMachine'],
  clicked: ['clickedHuman', 'clickedMachine'],
  converted: undefined,
};

/* ------------------------------- Message table ----------------------------- */

const MESSAGE_COLUMNS = ['sent', 'delivered', 'opened', 'clicked', 'unsubscribed'] as const;

/** The totals row, summed here so it can never disagree with the rows above it. */
function totalsOf(rows: readonly MessageStat[]) {
  return rows.reduce(
    (total, row) => ({
      sent: total.sent + row.sent,
      delivered: total.delivered + row.delivered,
      opened: total.opened + row.opened,
      clicked: total.clicked + row.clicked,
      unsubscribed: total.unsubscribed + row.unsubscribed,
    }),
    { sent: 0, delivered: 0, opened: 0, clicked: 0, unsubscribed: 0 }
  );
}

/* ---------------------------------- Page ---------------------------------- */

/**
 * A workflow's Overview: how the funnel is doing right now (four cards), which
 * single send is dragging the rest down (message metrics), and what people
 * clicked (links). One range, one granularity and one channel drive all three,
 * because three panels disagreeing about which fortnight they cover is worse
 * than no panels at all.
 */
function MetricsTab() {
  const { name } = workflowDetailRoute.useParams();
  const { config } = workflowDetailRoute.useRouteContext();
  const { t, i18n } = useTranslation();

  const [range, setRange] = useState<DateRange>(() => lastDays(30));
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [channel, setChannel] = useState<MetricChannel | undefined>(undefined);
  const [sortAscending, setSortAscending] = useState(true);

  const ir = lookup(config.workflows, name)?.toIR();
  const workflowName = ir?.name ?? '';

  const { data: points } = useQuery({
    queryKey: ['metrics', workflowName, range.from, range.to, granularity, channel ?? ALL],
    queryFn: async () =>
      (await config.stats?.metrics?.(workflowName, { ...range, granularity, channel })) ?? [],
    enabled: ir !== undefined && config.stats?.metrics !== undefined,
  });

  const { data: links } = useQuery({
    queryKey: ['links', workflowName, range.from, range.to, channel ?? ALL],
    queryFn: async () => (await config.stats?.links?.(workflowName, { ...range, channel })) ?? [],
    enabled: ir !== undefined && config.stats?.links !== undefined,
  });

  const { data: messages } = useQuery({
    queryKey: ['message-stats', workflowName, range.from, range.to, channel ?? ALL],
    queryFn: async () =>
      (await config.stats?.messages?.(workflowName, { ...range, channel })) ?? [],
    enabled: ir !== undefined && config.stats?.messages !== undefined,
  });

  /* The same glyphs the message table puts in front of its rows: a channel has
     to read the same in the picker as it does in the data it filters. */
  const channelOptions: DropdownOption[] = [
    { value: ALL, label: t('metrics.channel.all'), icon: ALL_CHANNELS_ICON },
    ...METRIC_CHANNELS.map((value) => ({
      value,
      label: t(`metrics.channel.${value}`),
      icon: CHANNEL_ICON[value],
    })),
  ];

  /**
   * What a message is called: the node's own label first (the author named
   * this send), then the template module's name, then the registry key — which
   * is wire identity and the last thing anyone wants to read.
   */
  const nameOf = (row: MessageStat): string => {
    const label = ir === undefined ? undefined : findNode(ir, row.nodeId)?.label?.trim();
    if (label !== undefined && label !== '') return label;
    const module = lookup(config.emails, row.template) ?? lookup(config.pushes, row.template);
    const moduleName = module?.name?.trim();
    return moduleName !== undefined && moduleName !== '' ? moduleName : row.template;
  };

  const rows = (messages ?? []).map((row) => ({ row, label: nameOf(row) }));
  rows.sort((a, b) => (sortAscending ? 1 : -1) * a.label.localeCompare(b.label));

  if (config.stats?.metrics === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div
          className="border-border bg-card max-w-md rounded-2xl border border-dashed p-8 text-center"
          style={superellipse}
        >
          <p className="text-sm font-medium">{t('metrics.noSource')}</p>
          <p className="text-muted mt-2 text-sm">{t('metrics.noSourceHint')}</p>
        </div>
      </div>
    );
  }

  const buckets = points ?? [];
  const last = buckets.at(-1);
  const previous = buckets.at(-2);
  /* Formatted once for all four cards: the hover readout wants a date a person
     can read, and the card has no locale of its own. Long form, weekday and
     all — the readout is the one place there is room for it, and a weekday is
     what tells you whether a dip is the weekend. A month bucket has no weekday
     worth printing, so it names the month instead. */
  const dates = buckets.map((point) => {
    const day = parseIsoDay(point.date);
    if (granularity === 'month') {
      return day.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' });
    }
    /* A week is keyed by its Monday, so naming that Monday would read as one
       day's number when the value is seven days summed. Say which week it is. */
    if (granularity === 'week') {
      return t('metrics.range.weekOf', {
        date: day.toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' }),
      });
    }
    return day.toLocaleDateString(i18n.language, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  });

  /** '-419 from last day' — the unit of comparison is the bucket, so it follows granularity. */
  const fromLast = (text: string) => {
    if (granularity === 'week') return t('metrics.fromLast.week', { value: text });
    if (granularity === 'month') return t('metrics.fromLast.month', { value: text });
    return t('metrics.fromLast.day', { value: text });
  };

  /**
   * The lines one card plots: its total, and — where the source measured them
   * — the human and machine halves of it.
   *
   * Presence in the data is the switch, not a channel the UI hardcodes. The
   * demo source reports the split for email alone, which is where the pixel
   * prefetch problem lives, so All channels and every other filter come back
   * single-line on their own; a project that learns to tell a scanner from a
   * person on another transport gets three lines there without a UI change.
   */
  const seriesOf = (key: CardKey): MetricSeries[] => {
    const head = { label: t(`metrics.${key}`), values: buckets.map(SERIES[key]) };
    const split = SPLIT[key];
    if (split === undefined) return [head];
    /* Partial coverage is worse than none: halves that only sometimes sum to
       the whole read as a broken measurement rather than a narrower filter. */
    if (!buckets.every((point) => split.every((half) => point[half] !== undefined))) return [head];
    return [
      head,
      ...split.map((half) => ({
        label: t(`metrics.series.${half}`),
        values: buckets.map((point) => rate(point[half] ?? 0, point.delivered)),
      })),
    ];
  };

  const cardOf = (key: CardKey) => {
    const pick = SERIES[key];
    const format = key === 'sent' ? number : percent;
    const current = last === undefined ? 0 : pick(last);
    const delta =
      previous === undefined || last === undefined ? undefined : current - pick(previous);
    return (
      <MetricCard
        key={key}
        label={t(`metrics.${key}`)}
        value={last === undefined ? '—' : format(current)}
        delta={
          delta === undefined
            ? undefined
            : { text: fromLast(signed(delta, format)), trend: trendOf(delta) }
        }
        dates={dates}
        series={seriesOf(key)}
        format={format}
      />
    );
  };

  const topLinks = [...(links ?? [])].sort((a, b) => b.clicks - a.clicks).slice(0, LINK_LIMIT);
  const totals = totalsOf(rows.map((entry) => entry.row));

  return (
    <div className="flex-1 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker value={range} onChange={setRange} />
        <Dropdown
          value={granularity}
          options={GRANULARITIES.map((value) => ({
            value,
            label: t(`metrics.granularity.${value}`),
          }))}
          onChange={(value) => setGranularity(GRANULARITIES.find((g) => g === value) ?? 'day')}
          className="w-auto"
        />
        <Dropdown
          value={channel ?? ALL}
          options={channelOptions}
          onChange={(value) => setChannel(asChannel(value))}
          className="w-auto"
        />
      </div>

      {buckets.length === 0 ? (
        <p className="text-muted mt-6 text-sm">{t('metrics.noData')}</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{CARD_KEYS.map(cardOf)}</div>
      )}

      {config.stats.messages !== undefined && (
        <Panel title={t('metrics.messages.title')}>
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold">
                <th className="border-border border-b px-4 py-2.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    onClick={() => setSortAscending((ascending) => !ascending)}
                  >
                    {t('metrics.messages.actionName')}
                    {sortAscending ? (
                      <ChevronUp size={14} strokeWidth={2} aria-hidden className="text-muted" />
                    ) : (
                      <ChevronDown size={14} strokeWidth={2} aria-hidden className="text-muted" />
                    )}
                  </button>
                </th>
                {MESSAGE_COLUMNS.map((column) => (
                  <th key={column} className="border-border w-32 border-b px-4 py-2.5">
                    {t(`metrics.messages.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="text-muted px-4 py-4 text-sm" colSpan={MESSAGE_COLUMNS.length + 1}>
                    {t('metrics.messages.empty')}
                  </td>
                </tr>
              ) : (
                <>
                  <tr>
                    <td className="border-border border-b px-4 py-3 align-top font-semibold">
                      {t('metrics.messages.allMessages')}
                    </td>
                    <FunnelCell rate={SENT_SHARE} count={totals.sent} />
                    <FunnelCell
                      rate={share(totals.delivered, totals.sent)}
                      count={totals.delivered}
                    />
                    <FunnelCell
                      rate={share(totals.opened, totals.delivered)}
                      count={totals.opened}
                    />
                    <FunnelCell
                      rate={share(totals.clicked, totals.delivered)}
                      count={totals.clicked}
                    />
                    <FunnelCell
                      rate={share(totals.unsubscribed, totals.delivered)}
                      count={totals.unsubscribed}
                    />
                  </tr>
                  {rows.map(({ row, label }) => {
                    const RowGlyph = channelIcon(row.channel);
                    return (
                      <tr key={row.nodeId} className="last:[&>td]:border-b-0">
                        <td className="border-border border-b px-4 py-3 align-top">
                          <span className="flex items-center gap-2">
                            <RowGlyph
                              size={14}
                              strokeWidth={2}
                              aria-hidden
                              className="text-muted shrink-0"
                            />
                            <Link
                              to="/templates/$key"
                              params={{ key: row.template }}
                              className="text-accent truncate hover:underline"
                            >
                              {label}
                            </Link>
                          </span>
                        </td>
                        <FunnelCell rate={SENT_SHARE} count={row.sent} />
                        <FunnelCell rate={share(row.delivered, row.sent)} count={row.delivered} />
                        <FunnelCell rate={share(row.opened, row.delivered)} count={row.opened} />
                        <FunnelCell rate={share(row.clicked, row.delivered)} count={row.clicked} />
                        <FunnelCell
                          rate={share(row.unsubscribed, row.delivered)}
                          count={row.unsubscribed}
                        />
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </Panel>
      )}

      {config.stats.links !== undefined && (
        <Panel title={t('metrics.links.title')}>
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold">
                <th className="border-border border-b px-5 py-2.5">
                  {t('metrics.links.topClicked')}
                </th>
                <th className="border-border w-40 border-b px-5 py-2.5 text-right">
                  {t('metrics.links.totalClicks')}
                </th>
              </tr>
            </thead>
            <tbody>
              {topLinks.length === 0 ? (
                <tr>
                  <td className="text-muted px-5 py-4 text-sm" colSpan={2}>
                    {t('metrics.links.empty')}
                  </td>
                </tr>
              ) : (
                topLinks.map((link) => (
                  <tr key={link.url} className="last:[&>td]:border-b-0">
                    <td className="border-border truncate border-b px-5 py-2.5" title={link.url}>
                      {link.url}
                    </td>
                    <td className="border-border border-b px-5 py-2.5 text-right tabular-nums">
                      {number(link.clicks)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

export const workflowMetricsRoute = createRoute({
  getParentRoute: () => workflowDetailRoute,
  path: '/',
  component: MetricsTab,
});
