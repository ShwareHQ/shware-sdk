import type { ConditionIR, WorkflowIR } from '@shware/workflow';
import { createRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { superellipse } from '../../components/corner-shape';
import { Route as rootRoute } from './__root';

/**
 * Segments referenced by these workflows, derived from IR the same way the
 * email list is — so a segment used in a condition but never passed to the
 * config is visible rather than silently missing.
 */
export function collectSegmentRefs(irs: WorkflowIR[]): { name: string; usedBy: string[] }[] {
  const byName = new Map<string, Set<string>>();

  const walkCondition = (condition: ConditionIR | undefined, workflow: string) => {
    if (condition === undefined) return;
    switch (condition.type) {
      case 'segment': {
        const set = byName.get(condition.segment) ?? new Set();
        set.add(workflow);
        byName.set(condition.segment, set);
        break;
      }
      case 'and':
      case 'or':
        for (const child of condition.conditions) walkCondition(child, workflow);
        break;
      case 'not':
        walkCondition(condition.condition, workflow);
        break;
      default:
        break;
    }
  };

  const walkNodes = (nodes: WorkflowIR['flow'], workflow: string) => {
    for (const node of nodes) {
      if (node.type === 'branch') {
        for (const branchCase of node.cases) {
          walkCondition(branchCase.condition, workflow);
          walkNodes(branchCase.flow, workflow);
        }
        if (node.otherwise) walkNodes(node.otherwise, workflow);
      }
      if (node.type === 'filter') walkCondition(node.condition, workflow);
      if (node.type === 'wait_until') {
        walkCondition(node.condition, workflow);
        if (Array.isArray(node.onTimeout)) walkNodes(node.onTimeout, workflow);
      }
      if (node.type === 'cohort') for (const arm of node.arms) walkNodes(arm.flow, workflow);
    }
  };

  for (const ir of irs) {
    if (ir.trigger.type === 'segment') {
      const set = byName.get(ir.trigger.segment) ?? new Set();
      set.add(ir.name);
      byName.set(ir.trigger.segment, set);
    }
    if (ir.trigger.type === 'event') walkCondition(ir.trigger.filter, ir.name);
    walkCondition(ir.goal?.condition, ir.name);
    walkCondition(ir.exitWhen, ir.name);
    walkNodes(ir.flow, ir.name);
  }

  return [...byName.entries()]
    .map(([name, usedBy]) => ({ name, usedBy: [...usedBy] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Render a condition tree as one readable line. */
function describe(condition: ConditionIR): string {
  switch (condition.type) {
    case 'and':
      return condition.conditions.map(describe).join(' and ');
    case 'or':
      return condition.conditions.map(describe).join(' or ');
    case 'not':
      return `not ${describe(condition.condition)}`;
    case 'segment':
      return condition.segment;
    case 'performed':
      return `did ${condition.event}${condition.within ? ` within ${condition.within.value}` : ''}`;
    case 'property':
      return `${condition.path} ${condition.op}${
        condition.value !== undefined ? ` ${String(condition.value)}` : ''
      }`;
  }
}

function Segments() {
  const { config } = segmentsRoute.useRouteContext();
  const { t } = useTranslation();

  const refs = useMemo(
    () => collectSegmentRefs(Object.values(config.workflows).map((builder) => builder.toIR())),
    [config]
  );

  /** Definitions live in the config; without them only the name is known. */
  const defined = new Map(
    config.segments.map((segment) => [
      segment.name,
      (segment as unknown as { definition: ConditionIR }).definition,
    ])
  );

  if (refs.length === 0) {
    return (
      <div className="text-muted flex h-full items-center justify-center text-sm">
        {t('segments.empty')}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <h1 className="text-lg font-semibold">{t('segments.title')}</h1>
      <ul className="mt-5 space-y-2">
        {refs.map((ref) => {
          const definition = defined.get(ref.name);
          return (
            <li
              key={ref.name}
              className="border-border bg-card rounded-2xl border px-5 py-4"
              style={superellipse}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-medium">{ref.name}</span>
                {definition === undefined && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
                    {t('segments.notDefined')}
                  </span>
                )}
              </div>
              {definition !== undefined && (
                <p className="text-secondary mt-1.5 font-mono text-xs">{describe(definition)}</p>
              )}
              <p className="text-muted mt-2 text-xs">
                {t('segments.usedBy')}: {ref.usedBy.join(', ')}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const segmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/segments',
  component: Segments,
});
