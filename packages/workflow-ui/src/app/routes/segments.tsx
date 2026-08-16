import type { ConditionIR, WorkflowIR } from '@shware/workflow';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, createRoute, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { superellipse } from '../../components/corner-shape';
import { SegmentList, describeCondition } from '../../components/segment-list';
import { EditableText } from '../../components/templates-page';
import { displayName } from '../../utils/label';
import { reportSave, studioPost } from '../studio';
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

function Segments() {
  const { config } = segmentsRoute.useRouteContext();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const refs = useMemo(
    () => collectSegmentRefs(Object.values(config.workflows).map((builder) => builder.toIR())),
    [config]
  );

  const items = useMemo(() => {
    /** Definitions come from the discovered segments; a reference alone gives only a name. */
    const declared = new Map(
      config.segments.map((segment) => [
        segment.name,
        segment as unknown as { definition: ConditionIR; meta?: { name?: string } },
      ])
    );
    return refs.map((ref) => {
      const found = declared.get(ref.name);
      return {
        ...ref,
        ...(found !== undefined ? { definition: found.definition } : {}),
        ...(found?.meta?.name !== undefined ? { label: found.meta.name } : {}),
      };
    });
  }, [refs, config]);

  const { data: reports } = useQuery({
    queryKey: ['segment-reports'],
    queryFn: async () => (await config.stats?.segments?.()) ?? [],
    enabled: config.stats?.segments !== undefined,
  });

  if (refs.length === 0) {
    return (
      <div className="text-muted flex h-full items-center justify-center text-sm">
        {t('segments.empty')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6 pb-4">
        <h1 className="text-lg font-semibold">{t('segments.title')}</h1>
      </div>
      <div className="min-h-0 flex-1">
        <SegmentList
          items={items}
          {...(reports !== undefined ? { reports } : {})}
          onOpen={(name) => void navigate({ to: '/segments/$name', params: { name } })}
        />
      </div>
    </div>
  );
}

export const segmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/segments',
  component: Segments,
});

/* --------------------------- Detail (tabbed shell) -------------------------- */

const TABS = [{ to: '/segments/$name', label: 'segments.tabs.overview', exact: true }] as const;

function SegmentDetail() {
  const { name } = segmentDetailRoute.useParams();
  const { config } = segmentDetailRoute.useRouteContext();
  const { t } = useTranslation();

  const declared = config.segments.find((segment) => segment.name === name) as
    | {
        definition: ConditionIR;
        meta?: { name?: string; description?: string };
        loc?: { file: string; line: number; column: number };
      }
    | undefined;
  const definition = declared;
  const declaredMeta = declared?.meta;
  /*
   * A segment's labels are its third argument, which may not be written yet —
   * the insert path handles that, appending `{ name: '…' }` to the call.
   */
  const loc = declared?.loc;
  const saveMeta = (field: 'name' | 'description') => (value: string) =>
    reportSave(studioPost('/__studio/node', { ...loc, path: `2.${field}`, value }), {
      saved: t('inspector.saved'),
      failed: t('inspector.saveFailed'),
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border bg-card flex shrink-0 items-center gap-4 border-b px-6 py-3">
        <Link
          to="/segments"
          className="text-muted hover:bg-hover flex size-7 items-center justify-center rounded-lg transition-colors"
          style={superellipse}
          aria-label={t('common.back')}
        >
          <ArrowLeft className="size-4" strokeWidth={2} />
        </Link>
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {loc !== undefined ? (
              <EditableText
                value={declaredMeta?.name}
                noneLabel={t('common.untitled')}
                onSave={saveMeta('name')}
              />
            ) : (
              displayName(declaredMeta?.name, t('common.untitled'))
            )}
          </div>
          <div className="text-muted truncate text-xs">
            {loc !== undefined ? (
              <EditableText
                value={declaredMeta?.description}
                noneLabel={t('common.addDescription')}
                onSave={saveMeta('description')}
              />
            ) : null}
          </div>
          <div className="text-muted truncate font-mono text-xs">
            {definition ? describeCondition(definition.definition) : t('segments.notDefined')}
          </div>
        </div>
        <nav className="ml-auto flex items-center gap-1">
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              params={{ name }}
              activeOptions={{ exact: tab.exact }}
              className="text-secondary hover:bg-hover rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors"
              activeProps={{ className: '!bg-primary !text-card' }}
              style={superellipse}
            >
              {t(tab.label)}
            </Link>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export const segmentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/segments/$name',
  component: SegmentDetail,
});
