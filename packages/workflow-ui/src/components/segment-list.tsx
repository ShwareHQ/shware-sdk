import type { ConditionIR } from '@shware/workflow';
import { clsx } from 'clsx';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SegmentReport } from '../config';
import { displayName } from '../utils/label';
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
  /** Wire key: how IR and the engine refer to it. Identity, not a label. */
  name: string;
  /** Human label from `segment(key, cond, { name })`; the list shows this. */
  label?: string;
  /** Workflows that reference it, by name. */
  usedBy: string[];
  /** The condition, when the segment is declared rather than merely referenced. */
  definition?: ConditionIR;
}

export interface SegmentListProps {
  items: SegmentListItem[];
  reports?: SegmentReport[];
  /** Open a segment's detail; the row is only clickable when this is provided. */
  onOpen?: (name: string) => void;
}

const OPERATOR: Record<string, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'in',
  contains: 'contains',
  exists: 'is set',
};

/**
 * One readable line per condition tree. Operators render as symbols — `eq` is
 * an IR token, not something a reader should have to translate.
 */
export function describeCondition(condition: ConditionIR): string {
  switch (condition.type) {
    case 'and':
      return condition.conditions.map(describeCondition).join(' and ');
    case 'or':
      return condition.conditions.map(describeCondition).join(' or ');
    case 'not':
      return `not ${describeCondition(condition.condition)}`;
    case 'segment':
      return condition.segment;
    case 'performed':
      return `did ${condition.event}${
        condition.where ? ` where ${describeCondition(condition.where)}` : ''
      }${condition.within ? ` within ${condition.within.value}` : ''}`;
    case 'property':
      return `${condition.path} ${OPERATOR[condition.op] ?? condition.op}${
        condition.value !== undefined ? ` ${String(condition.value)}` : ''
      }`;
    case 'payload':
      return `event.${condition.path} ${OPERATOR[condition.op] ?? condition.op}${
        condition.value !== undefined ? ` ${String(condition.value)}` : ''
      }`;
  }
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

export function SegmentList({ items, reports, onOpen }: SegmentListProps) {
  const { t } = useTranslation();
  const byName = new Map((reports ?? []).map((report) => [report.name, report]));

  return (
    <div className="h-full overflow-auto">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <thead className="bg-page/95 sticky top-0 z-10 backdrop-blur">
          <tr className="text-muted text-left text-xs font-medium">
            <th className="border-border min-w-0 border-b px-6 py-3">{t('common.name')}</th>
            <th className="border-border w-28 border-b px-3 py-3">{t('segments.size')}</th>
            <th className="border-border w-32 border-b px-3 py-3">{t('segments.overTime')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const report = byName.get(item.name);
            const movement = trend(report?.series);

            return (
              <tr
                key={item.name}
                {...(onOpen ? { onClick: () => onOpen(item.name) } : {})}
                className={clsx(
                  'align-top transition-colors',
                  onOpen && 'hover:bg-hover cursor-pointer'
                )}
              >
                <td className="border-border border-b px-6 py-4">
                  <div className="flex items-start gap-3">
                    <Users className="text-muted mt-0.5 size-4 shrink-0" strokeWidth={2} />
                    <div className="min-w-0">
                      <div
                        className={clsx(
                          'flex items-center gap-2 font-medium',
                          item.label === undefined ? 'text-muted italic' : 'text-primary'
                        )}
                      >
                        {displayName(item.label, t('common.untitled'))}
                        {item.definition === undefined && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
                            {t('segments.notDefined')}
                          </span>
                        )}
                      </div>
                      {item.definition !== undefined && (
                        <p className="text-secondary mt-1 truncate font-mono text-sm">
                          {describeCondition(item.definition)}
                        </p>
                      )}
                      <div className="text-muted mt-2 truncate text-xs">
                        {t('segments.usedBy')}: {item.usedBy.join(', ')}
                      </div>
                    </div>
                  </div>
                </td>

                <td className="border-border border-b px-3 py-4">
                  <div className="tabular-nums">
                    {report === undefined ? '—' : compact(report.size)}
                  </div>
                  {movement !== undefined && (
                    <div className="text-muted mt-1 text-xs tabular-nums">{movement.text}</div>
                  )}
                </td>

                <td className="border-border border-b px-3 py-4">
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
