import './index.css';
import type { WorkflowBuilder } from '@shware/workflow';
import * as examples from '@shware/workflow/examples';
import { type NodeStats, WorkflowCanvas, layout } from '@shware/workflow/react';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

const workflows: Record<string, WorkflowBuilder> = {
  checkoutRecovery: examples.checkoutRecovery,
  onboardingEdu: examples.onboardingEdu,
  winback: examples.winback,
  reengagement: examples.reengagement,
  onboarding: examples.onboarding,
  christmasPromo: examples.christmasPromo,
  activationNudge: examples.activationNudge,
};

function App() {
  const [selected, setSelected] = useState('checkoutRecovery');
  const ir = useMemo(() => (workflows[selected] ?? examples.checkoutRecovery).toIR(), [selected]);

  /** Mock 停留人数：等待类节点上演示徽标（真实数据将来自引擎统计接口）。 */
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2.5">
        <strong className="text-sm font-semibold text-slate-900">Workflow Playground</strong>
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
      </header>
      <main className="min-h-0 flex-1 bg-slate-50">
        <WorkflowCanvas key={selected} ir={ir} stats={stats} />
      </main>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing #root element');
createRoot(rootElement).render(<App />);
