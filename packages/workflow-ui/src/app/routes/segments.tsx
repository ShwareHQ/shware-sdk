import type { ConditionIR, WorkflowIR } from '@shware/workflow';
import { useQuery } from '@tanstack/react-query';
import { Outlet, createRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Breadcrumb } from '../../components/breadcrumb';
import { SearchInput } from '../../components/input/search-input';
import { SegmentList } from '../../components/segment-list';
import { displayName } from '../../utils/label';
import { PageChrome } from '../page-chrome';
import { Route as rootRoute } from './__root';

/**
 * Segments referenced by these workflows, derived from IR the same way the
 * email list is — so a segment used in a condition but never passed to the
 * config is visible rather than silently missing.
 */
export function collectSegmentRefs(irs: WorkflowIR[]): { id: string; usedBy: string[] }[] {
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
      set.add(ir.id);
      byName.set(ir.trigger.segment, set);
    }
    if (ir.trigger.type === 'event') walkCondition(ir.trigger.filter, ir.id);
    walkCondition(ir.goal?.condition, ir.id);
    walkCondition(ir.exitWhen, ir.id);
    walkNodes(ir.flow, ir.id);
  }

  return [...byName.entries()]
    .map(([id, usedBy]) => ({ id, usedBy: [...usedBy] }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every segment the studio shows: each deployed one — referenced by a workflow or not, since a
 * segment is an audience worth watching on its own — plus each one a workflow references without
 * it being deployed (shown as not defined). The IR only adds who uses it.
 */
export function collectSegments(
  irs: WorkflowIR[],
  deployed: readonly { id: string }[]
): { id: string; usedBy: string[] }[] {
  const byId = new Map(collectSegmentRefs(irs).map((ref) => [ref.id, ref]));
  for (const { id } of deployed) {
    if (!byId.has(id)) byId.set(id, { id, usedBy: [] });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function Segments() {
  const { config } = segmentsRoute.useRouteContext();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const refs = useMemo(
    () => collectSegments(Object.values(config.workflows), config.segments),
    [config]
  );

  const items = useMemo(() => {
    /** Definitions come from the compiled segments; a reference alone gives only a name. */
    const declared = new Map(config.segments.map((segment) => [segment.id, segment]));
    return refs.map((ref) => {
      const found = declared.get(ref.id);
      return {
        ...ref,
        ...(found !== undefined ? { definition: found.condition } : {}),
        ...(found?.meta?.name !== undefined ? { label: found.meta.name } : {}),
        ...(found?.meta?.description !== undefined ? { description: found.meta.description } : {}),
      };
    });
  }, [refs, config]);

  /* Substring match over everything a segment is known by: key, label, description. */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return items;
    return items.filter((item) =>
      [item.id, item.label ?? '', item.description ?? ''].some((text) =>
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
      <div className="text-muted flex flex-1 items-center justify-center text-sm">
        {t('segments.empty')}
      </div>
    );
  }

  return (
    /* Nothing here scrolls: the shell's content column is the one scrollport. */
    <div className="flex-1">
      <PageChrome breadcrumb={<Breadcrumb items={[{ label: t('nav.segments') }]} />} />
      {/*
        The search field belongs with what it filters, not up in the chrome.
        It scrolls away with the list: only the app header pins, and a stack
        of three fixed bars over a short list was more chrome than content.
      */}
      <div className="px-6 pt-4 pb-3">
        <SearchInput
          className="w-72"
          placeholder={t('segments.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="px-6 pb-6">
        {filtered.length === 0 ? (
          <div className="text-muted flex items-center justify-center py-24 text-sm">
            {t('segments.noMatches', { query: query.trim() })}
          </div>
        ) : (
          <SegmentList
            items={filtered}
            {...(reports !== undefined ? { reports } : {})}
            onOpen={(id) => void navigate({ to: '/segments/$id', params: { id } })}
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

/* ------------------------------- Detail shell ------------------------------ */

function SegmentDetail() {
  const { id } = segmentDetailRoute.useParams();
  const { config } = segmentDetailRoute.useRouteContext();
  const { t } = useTranslation();

  /* Switcher options: every segment the workflows reference, like the list page. */
  const options = useMemo(() => {
    const declared = new Map(config.segments.map((segment) => [segment.id, segment]));
    const refs = collectSegments(Object.values(config.workflows), config.segments);
    return refs.map((ref) => ({
      value: ref.id,
      label: displayName(declared.get(ref.id)?.meta?.name, ref.id),
    }));
  }, [config]);

  /*
   * The header is the root's: breadcrumb with the segment switcher as its
   * leaf. No tab strip — there is exactly one view here, and a strip of one
   * tab is a control that can never do anything. The breadcrumb still ends in
   * the view's name, which is what keeps this page the same shape as the
   * workflow detail page, where the tabs are real.
   */
  return (
    <div className="flex flex-1 flex-col">
      <PageChrome
        breadcrumb={
          <Breadcrumb
            items={[
              { label: t('nav.segments'), to: '/segments' },
              {
                label: options.find((option) => option.value === id)?.label ?? id,
                to: '/segments/$id',
                params: { id },
              },
              { label: t('segments.tabs.overview') },
            ]}
          />
        }
      />

      <div className="flex flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}

export const segmentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/segments/$id',
  component: SegmentDetail,
});
