import type { ConditionIR } from '@shware/workflow';
import { clsx } from 'clsx';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SegmentReport } from '../config';
import { displayName } from '../utils/label';
import { superellipse } from './corner-shape';
import { Sparkline } from './sparkline';

/**
 * Segments as a table, the same shape the workflows list uses: identity on the
 * left, runtime numbers on the right.
 *
 * Size is the column that matters. A segment's definition is code and can be
 * read in the editor; what the editor cannot tell you is whether the condition
 * you wrote actually matches the population you meant, and that only shows up
 * as a number and its trend.
 */
export interface SegmentListItem {
  /** Wire key: how IR and the engine refer to it (`segment({ id })`). Identity, not a label. */
  id: string;
  /** Human label from `segment({ id, name })`; the list shows it, else the key. */
  label?: string;
  /** `segment({ description })`: the second line, when there is one. */
  description?: string;
  /** Workflows that reference it, by id. */
  usedBy: string[];
  /** The condition, when the segment is declared rather than merely referenced. */
  definition?: ConditionIR;
}

export interface SegmentListProps {
  items: SegmentListItem[];
  reports?: SegmentReport[];
  /** Open a segment's detail; the row is only clickable when this is provided. */
  onOpen?: (id: string) => void;
}

const compact = (value: number) =>
  value >= 1000
    ? `${(value / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}k`
    : `${value}`;

/** Percentage change across the series, so the number has a direction. */
function trend(series: readonly number[] | undefined): { text: string; up: boolean } | undefined {
  const first = series?.at(0);
  const last = series?.at(-1);
  if (first === undefined || last === undefined || first === 0) return undefined;
  const change = ((last - first) / first) * 100;
  return { text: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, up: change >= 0 };
}

/*
 * Not pinned: the app header is the only sticky chrome, so the head scrolls
 * away with the rows and needs no opaque fill of its own. The radii stay —
 * the card has no `overflow` to clip with, so its top corners are cut here.
 */
const HEAD_CELL = 'border-border border-b py-3 first:rounded-tl-2xl last:rounded-tr-2xl';
/* The row carries the border below md, so the cells drop theirs there. */
const CELL = 'border-border border-b py-4 max-md:border-b-0 max-md:px-3';

export function SegmentList({ items, reports, onOpen }: SegmentListProps) {
  const { t } = useTranslation();
  const byId = new Map((reports ?? []).map((report) => [report.id, report]));

  return (
    /*
     * No `overflow` on the card, deliberately: any value at all turns it into
     * a scrollport of its own and draws a second bar inset inside the border —
     * the page is the one scroller (see __root). Nothing clips, so the corners
     * are re-cut on the first and last cells below.
     */
    <div className="border-border bg-card rounded-2xl border" style={superellipse}>
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm max-md:block">
        <thead className="max-md:hidden">
          <tr className="text-muted text-left text-xs font-medium">
            <th className={clsx(HEAD_CELL, 'min-w-0 px-6')} style={superellipse}>
              {t('common.name')}
            </th>
            <th className={clsx(HEAD_CELL, 'w-28 px-3')} style={superellipse}>
              {t('segments.size')}
            </th>
            <th className={clsx(HEAD_CELL, 'w-32 px-3')} style={superellipse}>
              {t('segments.overTime')}
            </th>
          </tr>
        </thead>
        <tbody className="max-md:block">
          {items.map((item) => {
            const report = byId.get(item.id);
            /* A blank label counts as none, like everywhere else names are shown. */
            const label = displayName(item.label, '');
            const movement = trend(report?.series);

            return (
              <tr
                key={item.id}
                {...(onOpen ? { onClick: () => onOpen(item.id) } : {})}
                /*
                 * On desktop the hover fill lives on the cells, not the row: a
                 * row box paints its background underneath them, where no cell
                 * radius reaches it, so the last row would poke square grey
                 * corners out of the unclipped card. Below md the row is an
                 * ordinary grid box and takes both itself.
                 */
                className={clsx(
                  'align-top [&>td]:transition-colors',
                  /* Below md the row leaves table layout and becomes the card's
                     own grid, so the fill and the radius live on it there. */
                  'max-md:grid max-md:grid-cols-2 max-md:border-b max-md:px-3',
                  'border-border max-md:first:rounded-t-2xl max-md:last:rounded-b-2xl',
                  'max-md:last:border-b-0',
                  'last:[&>td]:border-b-0 md:last:[&>td:first-child]:rounded-bl-2xl',
                  'md:last:[&>td:last-child]:rounded-br-2xl',
                  onOpen && 'max-md:hover:bg-hover md:hover:[&>td]:bg-hover cursor-pointer'
                )}
                style={superellipse}
              >
                <td
                  className={clsx(CELL, 'px-6 max-md:order-1 max-md:col-span-2 max-md:pb-2')}
                  style={superellipse}
                >
                  <div className="flex items-start gap-3">
                    <Users className="text-muted mt-0.5 size-4 shrink-0" strokeWidth={2} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        {label !== '' ? (
                          label
                        ) : (
                          /* No label: the id, made readable — `used_api` reads "Used api". ::first-letter needs a block box, not the flex row. */
                          <span className="inline-block first-letter:uppercase">
                            {item.id.replaceAll('_', ' ')}
                          </span>
                        )}
                        {item.definition === undefined && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
                            {t('segments.notDefined')}
                          </span>
                        )}
                      </div>
                      {item.description !== undefined && (
                        <p className="text-secondary mt-1 truncate text-sm">{item.description}</p>
                      )}
                      <div className="text-muted mt-2 truncate text-xs">
                        {item.usedBy.length === 0
                          ? t('segments.unused')
                          : `${t('segments.usedBy')}: ${item.usedBy.join(', ')}`}
                      </div>
                    </div>
                  </div>
                </td>

                <td
                  className={clsx(CELL, 'px-3 max-md:order-2 max-md:pt-0 max-md:pb-4')}
                  style={superellipse}
                >
                  <div className="text-muted mb-1 truncate text-xs md:hidden">
                    {t('segments.size')}
                  </div>
                  <div className="tabular-nums">
                    {report === undefined ? '—' : compact(report.size)}
                  </div>
                  {movement !== undefined && (
                    <div className="text-muted mt-1 text-xs tabular-nums">{movement.text}</div>
                  )}
                </td>

                <td
                  className={clsx(CELL, 'px-3 max-md:order-3 max-md:pt-0 max-md:pb-4')}
                  style={superellipse}
                >
                  <div className="text-muted mb-1 truncate text-xs md:hidden">
                    {t('segments.overTime')}
                  </div>
                  <Sparkline values={report?.series ?? []} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
