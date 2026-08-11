import './index.css';
import type { WorkflowBuilder } from '@shware/workflow';
import * as examples from '@shware/workflow/examples';
import { type NodeStats, WorkflowCanvas, layout } from '@shware/workflow/react';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { collectTemplateRefs } from './template-refs';
import { TemplatesPage } from './templates-page';

const workflows: Record<string, WorkflowBuilder> = {
  checkoutRecovery: examples.checkoutRecovery,
  onboardingEdu: examples.onboardingEdu,
  winback: examples.winback,
  reengagement: examples.reengagement,
  onboarding: examples.onboarding,
  christmasPromo: examples.christmasPromo,
  activationNudge: examples.activationNudge,
};

/** The template list is derived from every example flow's IR (see template-refs.ts). */
const templateRefs = collectTemplateRefs(
  Object.values(workflows).map((workflow) => workflow.toIR())
);

type View = 'canvas' | 'templates';

const tabClass = (active: boolean) =>
  `rounded-md px-2.5 py-1 text-[13px] ${
    active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

function App() {
  const [view, setView] = useState<View>('canvas');
  const [selected, setSelected] = useState('checkoutRecovery');
  const [templateKey, setTemplateKey] = useState<string | undefined>(undefined);

  const ir = useMemo(() => (workflows[selected] ?? examples.checkoutRecovery).toIR(), [selected]);

  /** Mock waiting counts to demo the badge on delay nodes (real data will come from the engine's stats API). */
  const stats = useMemo<NodeStats>(() => {
    const mock: NodeStats = {};
    for (const node of layout(ir).nodes) {
      if (node.data.category === 'delay') {
        let seed = 0;
        for (let i = 0; i < node.id.length; i++) seed += node.id.charCodeAt(i);
        mock[node.id] = (seed * 37) % 500;
      }
    }
    return mock;
  }, [ir]);

  const openTemplate = (key: string) => {
    setTemplateKey(key);
    setView('templates');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2.5">
        <strong className="text-sm font-semibold text-slate-900">Workflow Playground</strong>
        <nav className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView('canvas')}
            className={tabClass(view === 'canvas')}
          >
            Workflows
          </button>
          <button
            type="button"
            onClick={() => setView('templates')}
            className={tabClass(view === 'templates')}
          >
            Templates
          </button>
        </nav>
        {view === 'canvas' && (
          <>
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-[13px]"
            >
              {Object.keys(workflows).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <span className="font-mono text-xs text-slate-500">
              {ir.name} · v1 · #{ir.contentHash.slice(0, 8)}
            </span>
          </>
        )}
      </header>
      <main className="min-h-0 flex-1 bg-slate-50">
        {view === 'canvas' ? (
          <WorkflowCanvas key={selected} ir={ir} stats={stats} onOpenTemplate={openTemplate} />
        ) : (
          <TemplatesPage refs={templateRefs} selected={templateKey} onSelect={setTemplateKey} />
        )}
      </main>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing #root element');
createRoot(rootElement).render(<App />);
