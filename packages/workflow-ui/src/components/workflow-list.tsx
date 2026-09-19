import type { NodeIR, WorkflowIR } from '@shware/workflow';
import { clsx } from 'clsx';
import { AlarmClock, Mail, Workflow as WorkflowIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkflowReport } from '../config';
import { displayName } from '../utils/label';
import { superellipse } from './corner-shape';
import { Menu } from './menu';
import { Sparkline } from './sparkline';

/**
 * The workflows list: one row per definition with its shape (how many
 * messages, how many waits) and the funnel from the stats source, all inside
 * a single card.
 *
 * One card of rows rather than a card per workflow: the four funnel numbers
 * are only worth showing because they can be read down a column, and a grid
 * of tiles breaks exactly that. Below `md` there are no columns left to align,
 * so a row folds into title-then-stats instead.
 */
export interface WorkflowListProps {
  /** Local definitions, keyed by the name used in the URL. */
  items: { key: string; ir: WorkflowIR }[];
  reports?: WorkflowReport[];
  onOpen: (key: string) => void;
  /** Open the edit dialog for a workflow; the row menu only appears when provided. */
  onEdit?: (key: string) => void;
}

/** Count message and delay nodes across the whole tree, arms included. */
function countNodes(nodes: readonly NodeIR[], acc = { messages: 0, delays: 0 }) {
  for (const node of nodes) {
    if (node.type === 'message') acc.messages++;
    if (node.type === 'delay' || node.type === 'random_delay' || node.type === 'wait_until') {
      acc.delays++;
    }
    if (node.type === 'branch') {
      for (const branchCase of node.cases) countNodes(branchCase.flow, acc);
      if (node.otherwise) countNodes(node.otherwise, acc);
    }
    if (node.type === 'cohort') for (const arm of node.arms) countNodes(arm.flow, acc);
    if (node.type === 'wait_until' && Array.isArray(node.onTimeout)) {
      countNodes(node.onTimeout, acc);
    }
  }
  return acc;
}

const compact = (value: number) =>
  value >= 1000
    ? `${(value / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}k`
    : `${value}`;

const rate = (part: number | undefined, whole: number | undefined) =>
  part === undefined || whole === undefined || whole === 0
    ? '—'
    : `${((part / whole) * 100).toFixed(1)}%`;

const COLUMNS = ['delivered', 'opened', 'clicked', 'converted'] as const;

/*
 * Not pinned: the app header is the only sticky chrome, so the head scrolls
 * away with the rows and needs no opaque fill of its own. The radii stay —
 * the card has no `overflow` to clip with, so its top corners are cut here.
 */
const HEAD_CELL = 'border-border border-b py-3 first:rounded-tl-2xl last:rounded-tr-2xl';

/*
 * Stacked, every cell is inset by the row's own padding instead of its own,
 * so the four metrics line up with the title above them and the row's hover
 * fill still reaches the card's edges.
 */
const CELL = 'border-border border-b py-4 max-md:border-b-0 max-md:px-3';

/*
 * The studio's palette is monochrome; colour is reserved for state. Running /
 * draft is state, so it keeps green and grey.
 */

export function WorkflowList({ items, reports, onOpen, onEdit }: WorkflowListProps) {
  const { t } = useTranslation();
  const byName = new Map((reports ?? []).map((report) => [report.name, report]));

  return (
    /*
     * No `overflow` on the card, deliberately: any value at all turns it into
     * a scrollport of its own and draws a second bar inset inside the border —
     * the page is the one scroller (see __root). Nothing clips, so the corners
     * are re-cut on the first and last cells below.
     */
    <div className="border-border bg-card rounded-2xl border" style={superellipse}>
      {/* Below `md` the table leaves table layout entirely and each row lays
          itself out as a four-column grid — see the row classes. */}
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm max-md:block">
        <thead className="max-md:hidden">
          <tr className="text-muted text-left text-xs font-medium">
            <th className={clsx(HEAD_CELL, 'min-w-0 px-6')} style={superellipse}>
              {t('common.name')}
            </th>
            <th className={clsx(HEAD_CELL, 'w-28 px-3')} style={superellipse} />
            {COLUMNS.map((column) => (
              <th key={column} className={clsx(HEAD_CELL, 'w-28 px-3')} style={superellipse}>
                {t(`workflows.columns.${column}`)}
              </th>
            ))}
            {onEdit !== undefined && (
              <th className={clsx(HEAD_CELL, 'w-14 px-3')} style={superellipse} />
            )}
          </tr>
        </thead>
        <tbody className="max-md:block">
          {items.map(({ key, ir }) => {
            const shape = countNodes(ir.flow);
            const report = byName.get(ir.name);
            const values: Record<(typeof COLUMNS)[number], string> = {
              delivered: report?.delivered === undefined ? '—' : compact(report.delivered),
              opened: rate(report?.opened, report?.delivered),
              clicked: rate(report?.clicked, report?.delivered),
              converted: rate(report?.converted, report?.entered),
            };

            return (
              <tr
                key={key}
                onClick={() => onOpen(key)}
                className={clsx(
                  'cursor-pointer align-top [&>td]:transition-colors',
                  /*
                   * Laid out as a table the hover fill has to live on the
                   * cells: a row box paints its background underneath them,
                   * where no cell radius reaches it, so the last row would
                   * poke square grey corners out of the card. Stacked, the row
                   * is an ordinary grid box and takes fill and radius itself.
                   */
                  'md:hover:[&>td]:bg-hover md:last:[&>td]:border-b-0',
                  'md:last:[&>td:first-child]:rounded-bl-2xl md:last:[&>td:last-child]:rounded-br-2xl',
                  /* Stacked: title (+ menu) / status / the metrics two by two
                     — four across a phone leaves no room for a label, let
                     alone the sparkline under it. */
                  'border-border max-md:hover:bg-hover max-md:grid max-md:grid-cols-6',
                  'max-md:border-b max-md:px-3 max-md:first:rounded-t-2xl',
                  'max-md:last:rounded-b-2xl max-md:last:border-b-0'
                )}
                style={superellipse}
              >
                <td
                  className={clsx(
                    CELL,
                    'px-6 max-md:order-1 max-md:pb-2',
                    onEdit === undefined ? 'max-md:col-span-6' : 'max-md:col-span-5'
                  )}
                  style={superellipse}
                >
                  <div className="flex items-start gap-3">
                    <WorkflowIcon className="text-muted mt-0.5 size-4 shrink-0" strokeWidth={2} />
                    <div className="min-w-0">
                      <div
                        className={clsx(
                          'truncate font-medium',
                          ir.meta?.name === undefined ? 'text-muted italic' : 'text-primary'
                        )}
                      >
                        {displayName(ir.meta?.name, t('common.untitled'))}
                      </div>
                      {ir.meta?.description !== undefined && (
                        <p className="text-muted mt-1 truncate text-sm">{ir.meta.description}</p>
                      )}
                      <div className="text-muted mt-2 flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1">
                          <Mail className="size-3.5" strokeWidth={2} />
                          {shape.messages}
                        </span>
                        <span className="flex items-center gap-1">
                          <AlarmClock className="size-3.5" strokeWidth={2} />
                          {shape.delays}
                        </span>
                      </div>
                    </div>
                  </div>
                </td>

                {/* Second in the DOM so the desktop column order holds; `order`
                    moves it under the title once the row is a grid. */}
                <td
                  className={clsx(
                    CELL,
                    'px-3 max-md:order-3 max-md:col-span-6 max-md:pt-0 max-md:pb-3'
                  )}
                  style={superellipse}
                >
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                      report
                        ? 'bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-300'
                        : 'bg-selected text-muted'
                    )}
                  >
                    <span
                      className={clsx(
                        'size-1.5 rounded-full',
                        report ? 'bg-green-500' : 'bg-muted'
                      )}
                    />
                    {report ? t('status.running') : t('status.draft')}
                  </span>
                </td>

                {COLUMNS.map((column) => (
                  <td
                    key={column}
                    className={clsx(
                      CELL,
                      'px-3 max-md:order-4 max-md:col-span-3 max-md:pt-0 max-md:pb-4'
                    )}
                    style={superellipse}
                  >
                    {/* The head is gone when stacked, so each figure names itself. */}
                    <div className="text-muted mb-1 truncate text-xs md:hidden">
                      {t(`workflows.columns.${column}`)}
                    </div>
                    <div className="tabular-nums">{values[column]}</div>
                    <Sparkline values={report?.series?.[column] ?? []} className="mt-1" />
                  </td>
                ))}

                {onEdit !== undefined && (
                  <td
                    className={clsx(CELL, 'px-3 max-md:order-2 max-md:col-span-1 max-md:pb-2')}
                    style={superellipse}
                  >
                    <div className="flex justify-end">
                      <Menu
                        aria-label={t('common.more')}
                        items={[
                          { key: 'edit', label: t('common.edit'), onSelect: () => onEdit(key) },
                        ]}
                      />
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
