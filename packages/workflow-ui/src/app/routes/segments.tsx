import type { ConditionIR, WorkflowIR } from '@shware/workflow';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { superellipse } from '../../components/corner-shape';
import { Dropdown } from '../../components/dropdown';
import { SearchInput } from '../../components/input/search-input';
import { SegmentList } from '../../components/segment-list';
import { Tabs } from '../../components/tabs';
import { displayName } from '../../utils/label';
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
  const [query, setQuery] = useState('');

  const refs = useMemo(
    () => collectSegmentRefs(Object.values(config.workflows).map((builder) => builder.toIR())),
    [config]
  );

  const items = useMemo(() => {
    /** Definitions come from the discovered segments; a reference alone gives only a name. */
    const declared = new Map(
      config.segments.map((segment) => [
        segment.name,
        segment as unknown as {
          definition: ConditionIR;
          meta?: { name?: string; description?: string };
        },
      ])
    );
    return refs.map((ref) => {
      const found = declared.get(ref.name);
      return {
        ...ref,
        ...(found !== undefined ? { definition: found.definition } : {}),
        ...(found?.meta?.name !== undefined ? { label: found.meta.name } : {}),
        description: found?.meta?.description ?? '',
      };
    });
  }, [refs, config]);

  /* Substring match over everything a segment is known by: key, label, description. */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return items;
    return items.filter((item) =>
      [item.name, item.label ?? '', item.description].some((text) =>
        text.toLowerCase().includes(needle)
      )
    );
  }, [items, query]);

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
      <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
        <h1 className="text-lg font-semibold">{t('segments.title')}</h1>
        <SearchInput
          className="w-64"
          placeholder={t('segments.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1">
        {filtered.length === 0 ? (
          <div className="text-muted flex h-full items-center justify-center text-sm">
            {t('segments.noMatches', { query: query.trim() })}
          </div>
        ) : (
          <SegmentList
            items={filtered}
            {...(reports !== undefined ? { reports } : {})}
            onOpen={(name) => void navigate({ to: '/segments/$name', params: { name } })}
          />
        )}
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
  const navigate = useNavigate();
  const { t } = useTranslation();

  /* Switcher options: every segment the workflows reference, like the list page. */
  const options = useMemo(() => {
    const declared = new Map(
      config.segments.map((segment) => [
        segment.name,
        segment as unknown as { meta?: { name?: string; description?: string } },
      ])
    );
    const refs = collectSegmentRefs(Object.values(config.workflows).map((b) => b.toIR()));
    return refs.map((ref) => ({
      value: ref.name,
      label: displayName(declared.get(ref.name)?.meta?.name, ref.name),
    }));
  }, [config]);

  /*
   * Same header as the workflow detail: back and the segment switcher on the
   * left, the view tabs centred by the grid's equal outer tracks. 60px tall
   * with a 1px bottom border.
   */
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border bg-card grid h-15 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/segments"
            className="text-muted hover:bg-hover flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={superellipse}
            aria-label={t('common.back')}
          >
            <ArrowLeft className="size-4" strokeWidth={2} />
          </Link>
          <Dropdown
            className="max-w-full"
            value={name}
            options={options}
            onChange={(next) => void navigate({ to: '/segments/$name', params: { name: next } })}
          />
        </div>
        <Tabs
          items={TABS.map((tab) => ({ to: tab.to, label: t(tab.label), exact: tab.exact }))}
          params={{ name }}
        />
        <div />
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
