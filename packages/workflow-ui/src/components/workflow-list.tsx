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
 * The workflows list: one card per definition with its shape (how many
 * messages, how many waits) and the funnel from the stats source.
 *
 * Cards rather than rows: a workflow is an object you go into, not a record you
 * scan down a column. The four funnel numbers still line up card to card,
 * because the metrics block is pinned to the bottom of every card in a row.
 */
export interface WorkflowListProps {
  /** Local definitions, keyed by the name used in the URL. */
  items: { key: string; ir: WorkflowIR }[];
  reports?: WorkflowReport[];
  onOpen: (key: string) => void;
  /** Open the edit dialog for a workflow; the card menu only appears when provided. */
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
 * The studio's palette is monochrome; colour is reserved for state. Running /
 * draft is state, so it keeps green and grey.
 */

export function WorkflowList({ items, reports, onOpen, onEdit }: WorkflowListProps) {
  const { t } = useTranslation();
  const byName = new Map((reports ?? []).map((report) => [report.name, report]));

  return (
    /* auto-fill against the container, so the rail collapsing re-flows the grid. */
    <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
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
          <div
            key={key}
            className="border-border bg-card focus-within:ring-accent/40 dark:focus-within:ring-accent/50 relative flex flex-col rounded-2xl border p-4 transition-colors focus-within:ring-3 hover:border-gray-300 dark:hover:border-gray-700"
            style={superellipse}
          >
            <div className="flex items-start gap-3">
              <WorkflowIcon className="text-muted mt-0.5 size-4 shrink-0" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                {/*
                  Stretched hit area: the title is the only real control, and its
                  ::after covers the card, so anywhere opens the workflow. The
                  menu sits above it on its own stacking level.
                */}
                <button
                  type="button"
                  onClick={() => onOpen(key)}
                  className={clsx(
                    'block w-full truncate text-left font-medium after:absolute after:inset-0 focus:outline-none',
                    ir.meta?.name === undefined ? 'text-muted italic' : 'text-primary'
                  )}
                >
                  {displayName(ir.meta?.name, t('common.untitled'))}
                </button>
                {ir.meta?.description !== undefined && (
                  <p className="text-muted mt-1 line-clamp-2 text-xs">{ir.meta.description}</p>
                )}
              </div>
              {onEdit !== undefined && (
                <div className="relative z-10 -mt-1 -mr-1">
                  <Menu
                    aria-label={t('common.more')}
                    items={[{ key: 'edit', label: t('common.edit'), onSelect: () => onEdit(key) }]}
                  />
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-3">
              <span
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                  report
                    ? 'bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-300'
                    : 'bg-selected text-muted'
                )}
              >
                <span
                  className={clsx('size-1.5 rounded-full', report ? 'bg-green-500' : 'bg-muted')}
                />
                {report ? t('status.running') : t('status.draft')}
              </span>
              <span className="text-muted flex items-center gap-1 text-xs">
                <Mail className="size-3.5" strokeWidth={2} />
                {shape.messages}
              </span>
              <span className="text-muted flex items-center gap-1 text-xs">
                <AlarmClock className="size-3.5" strokeWidth={2} />
                {shape.delays}
              </span>
            </div>

            {/* mt-auto: the funnel lines up across a row whatever the description's length. */}
            <div className="border-border mt-auto grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
              {COLUMNS.map((column) => (
                <div key={column} className="min-w-0">
                  <div className="text-muted truncate text-xs">
                    {t(`workflows.columns.${column}`)}
                  </div>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <span className="text-primary text-sm tabular-nums">{values[column]}</span>
                    <Sparkline
                      values={report?.series?.[column] ?? []}
                      width={60}
                      height={20}
                      className="shrink-0"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
