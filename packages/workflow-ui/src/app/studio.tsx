import { useEffect, useMemo, useState } from 'react';
import { ReportsPage } from '../components/reports-page';
import { collectTemplateRefs } from '../components/template-refs';
import { TemplatesPage } from '../components/templates-page';
import { WorkflowCanvas } from '../components/workflow-canvas';
import type { NodeStats, WorkflowUIConfig } from '../config';

/**
 * The studio shell: three views over one config. Navigation is component state
 * rather than a router, so the same shell can be embedded in a host app that
 * already owns the URL.
 */
type View = 'workflows' | 'templates' | 'reports';

const TABS: { id: View; label: string }[] = [
  { id: 'workflows', label: 'Workflows' },
  { id: 'templates', label: 'Templates' },
  { id: 'reports', label: 'Reports' },
];

const tabClass = (active: boolean) =>
  `rounded-md px-2.5 py-1 text-[13px] ${
    active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

/** Node badges come from the stats source; without one the canvas simply has none. */
function useNodeStats(config: WorkflowUIConfig, workflowName: string) {
  const [stats, setStats] = useState<NodeStats | undefined>(undefined);

  useEffect(() => {
    const load = config.stats?.nodeStats;
    if (load === undefined) {
      setStats(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await load(workflowName);
        if (!cancelled) setStats(next);
      } catch {
        if (!cancelled) setStats(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, workflowName]);

  return stats;
}

export function Studio({ config }: { config: WorkflowUIConfig }) {
  const names = Object.keys(config.workflows);
  const [view, setView] = useState<View>('workflows');
  const [selected, setSelected] = useState(names[0] ?? '');
  const [templateKey, setTemplateKey] = useState<string | undefined>(undefined);

  const ir = useMemo(() => config.workflows[selected]?.toIR(), [config, selected]);
  const nodeStats = useNodeStats(config, ir?.name ?? '');

  /** The template list is derived from every workflow's IR, not a hand-kept list. */
  const templateRefs = useMemo(
    () => collectTemplateRefs(Object.values(config.workflows).map((builder) => builder.toIR())),
    [config]
  );

  const openTemplate = (key: string) => {
    setTemplateKey(key);
    setView('templates');
  };

  return (
    <div className="flex h-full flex-col font-sans">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2.5">
        <strong className="text-sm font-semibold text-slate-900">
          {config.title ?? 'Workflow Studio'}
        </strong>
        <nav className="flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={tabClass(view === tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {view === 'workflows' && (
          <>
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-[13px]"
            >
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {ir && (
              <span className="font-mono text-xs text-slate-500">
                {ir.name} · v{ir.irVersion} · #{ir.contentHash.slice(0, 8)}
              </span>
            )}
            {ir?.meta?.description !== undefined && (
              <span className="truncate text-xs text-slate-500">{ir.meta.description}</span>
            )}
          </>
        )}
      </header>

      <main className="min-h-0 flex-1 bg-slate-50">
        {view === 'workflows' &&
          (ir ? (
            <WorkflowCanvas
              key={selected}
              ir={ir}
              {...(nodeStats !== undefined ? { stats: nodeStats } : {})}
              onOpenTemplate={openTemplate}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              No workflows exported from workflow.config.ts
            </div>
          ))}

        {view === 'templates' && (
          <TemplatesPage
            refs={templateRefs}
            emails={config.emails ?? {}}
            selected={templateKey}
            onSelect={setTemplateKey}
          />
        )}

        {view === 'reports' && (
          <ReportsPage
            workflowNames={Object.values(config.workflows).map((builder) => builder.toIR().name)}
            stats={config.stats}
          />
        )}
      </main>
    </div>
  );
}
