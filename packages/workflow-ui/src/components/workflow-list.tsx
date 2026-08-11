import type { NodeIR, WorkflowIR } from '@shware/workflow';
import { clsx } from 'clsx';
import { AlarmClock, Mail, Workflow as WorkflowIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkflowReport } from '../config';
import { Sparkline } from './sparkline';

/**
 * The workflows list: one row per definition with its shape (how many messages,
 * how many waits) and the funnel from the stats source.
 */
export interface WorkflowListProps {
  /** Local definitions, keyed by the name used in the URL. */
  items: { key: string; ir: WorkflowIR }[];
  reports?: WorkflowReport[];
  onOpen: (key: string) => void;
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

export function WorkflowList({ items, reports, onOpen }: WorkflowListProps) {
  const { t } = useTranslation();
  const byName = new Map((reports ?? []).map((report) => [report.name, report]));

  return (
    <div className="h-full overflow-auto">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
          <tr className="text-left text-xs font-medium text-slate-500">
            <th className="min-w-0 border-b border-slate-200 px-6 py-3">{t('common.name')}</th>
            <th className="w-24 border-b border-slate-200 px-3 py-3" />
            {COLUMNS.map((column) => (
              <th key={column} className="w-28 border-b border-slate-200 px-3 py-3">
                {t(`workflows.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
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
                className="cursor-pointer align-top transition-colors hover:bg-white"
              >
                <td className="border-b border-slate-100 px-6 py-4">
                  <div className="flex items-start gap-3">
                    <WorkflowIcon
                      className="mt-0.5 size-4 shrink-0 text-slate-400"
                      strokeWidth={2}
                    />
                    <div className="min-w-0">
                      <div className="font-medium text-teal-700">{ir.name}</div>
                      {ir.meta?.description !== undefined && (
                        <p className="mt-1 truncate text-[13px] text-slate-500">
                          {ir.meta.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Mail className="size-3.5" strokeWidth={2} />
                          {shape.messages}
                        </span>
                        <span className="flex items-center gap-1">
                          <AlarmClock className="size-3.5" strokeWidth={2} />
                          {shape.delays}
                        </span>
                        {ir.meta?.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </td>

                <td className="border-b border-slate-100 px-3 py-4">
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                      report ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    )}
                  >
                    <span
                      className={clsx(
                        'size-1.5 rounded-full',
                        report ? 'bg-emerald-500' : 'bg-slate-400'
                      )}
                    />
                    {report ? t('status.running') : t('status.draft')}
                  </span>
                </td>

                {COLUMNS.map((column) => (
                  <td key={column} className="border-b border-slate-100 px-3 py-4">
                    <div className="tabular-nums">{values[column]}</div>
                    <Sparkline values={report?.series?.[column] ?? []} className="mt-1" />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
