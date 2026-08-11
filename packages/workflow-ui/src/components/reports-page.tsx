import { useEffect, useState } from 'react';
import type { StatsSource, WorkflowReport } from '../config';

/**
 * Reports: per-workflow totals from the configured stats source.
 *
 * Without a source the page says so rather than inventing numbers — a studio
 * that quietly shows mock data is worse than one that shows none.
 */
export interface ReportsPageProps {
  /** Workflow names known from the local definitions, so gaps are visible. */
  workflowNames: string[];
  stats?: StatsSource | undefined;
}

const percent = (part: number, whole: number) =>
  whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;

const number = (value: number) => value.toLocaleString();

function useReports(stats: StatsSource | undefined) {
  const [state, setState] = useState<{
    rows?: WorkflowReport[];
    error?: string;
    loading: boolean;
  }>({ loading: stats?.reports !== undefined });

  useEffect(() => {
    const load = stats?.reports;
    if (load === undefined) {
      setState({ loading: false });
      return;
    }
    let cancelled = false;
    setState({ loading: true });
    void (async () => {
      try {
        const rows = await load();
        if (!cancelled) setState({ rows, loading: false });
      } catch (error) {
        if (!cancelled) {
          setState({
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stats]);

  return state;
}

export function ReportsPage({ workflowNames, stats }: ReportsPageProps) {
  const { rows, error, loading } = useReports(stats);

  if (stats?.reports === undefined) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-900">No stats source configured</p>
          <p className="mt-2 text-sm text-slate-500">
            Add a <code className="font-mono text-slate-700">stats.reports</code> function to{' '}
            <code className="font-mono text-slate-700">workflow.config.ts</code> to pull totals from
            your engine.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-sm text-slate-500">Loading reports…</div>;
  }

  if (error !== undefined) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  const byName = new Map((rows ?? []).map((row) => [row.name, row]));
  const missing = workflowNames.filter((name) => !byName.has(name));

  return (
    <div className="h-full overflow-auto p-6">
      <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-slate-500 uppercase">
            <th className="border-b border-slate-200 px-4 py-3 font-medium">Workflow</th>
            <th className="border-b border-slate-200 px-4 py-3 text-right font-medium">Entered</th>
            <th className="border-b border-slate-200 px-4 py-3 text-right font-medium">Active</th>
            <th className="border-b border-slate-200 px-4 py-3 text-right font-medium">
              Completed
            </th>
            <th className="border-b border-slate-200 px-4 py-3 text-right font-medium">
              Converted
            </th>
            <th className="border-b border-slate-200 px-4 py-3 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((row) => (
            <tr key={row.name} className="hover:bg-slate-50">
              <td className="border-b border-slate-100 px-4 py-3 font-mono text-[13px] text-slate-900">
                {row.name}
              </td>
              <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">
                {number(row.entered)}
              </td>
              <td className="border-b border-slate-100 px-4 py-3 text-right text-slate-600 tabular-nums">
                {number(row.active)}
              </td>
              <td className="border-b border-slate-100 px-4 py-3 text-right text-slate-600 tabular-nums">
                {number(row.completed)}
              </td>
              <td className="border-b border-slate-100 px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                {number(row.converted)}
              </td>
              <td className="border-b border-slate-100 px-4 py-3 text-right tabular-nums">
                {percent(row.converted, row.entered)}
              </td>
            </tr>
          ))}
          {missing.map((name) => (
            <tr key={name} className="text-slate-400">
              <td className="border-b border-slate-100 px-4 py-3 font-mono text-[13px]">{name}</td>
              <td className="border-b border-slate-100 px-4 py-3 text-right" colSpan={5}>
                not deployed yet
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
