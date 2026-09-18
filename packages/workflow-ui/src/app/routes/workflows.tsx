import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, Outlet, createRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { Rocket } from 'lucide-react';
import { type CSSProperties, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Breadcrumb } from '../../components/breadcrumb';
import { Button } from '../../components/button';
import { Input } from '../../components/input';
import { SearchInput } from '../../components/input/search-input';
import { Modal, ModalTitle } from '../../components/modal';
import {
  type EditableField,
  NodeInspector,
  type NodeSource,
  fieldsOf,
} from '../../components/node-inspector';
import { Tabs } from '../../components/tabs';
import { findNode, nodesPerSourcePosition } from '../../components/template-refs';
import { Textarea } from '../../components/textarea';
import { WorkflowCanvas } from '../../components/workflow-canvas';
import { WorkflowList } from '../../components/workflow-list';
import { displayName } from '../../utils/label';
import { lookup } from '../../utils/lookup';
import { useTheme } from '../integrations/theme/root-provider';
import { PageChrome } from '../page-chrome';
import { reportSave, studioGet, studioPost } from '../studio';
import { Route as rootRoute } from './__root';

/* ---------------------------------- List ---------------------------------- */

/** Draft for the edit dialog; `original` decides which fields actually changed on save. */
interface EditDraft {
  key: string;
  loc: Record<string, unknown> | undefined;
  name: string;
  description: string;
  original: { name: string; description: string };
}

function WorkflowsIndex() {
  const { config } = workflowsIndexRoute.useRouteContext();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<EditDraft | undefined>(undefined);

  const items = useMemo(
    () => Object.entries(config.workflows).map(([key, builder]) => ({ key, ir: builder.toIR() })),
    [config]
  );

  /* Substring match over everything a workflow is known by: key, name, description. */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return items;
    return items.filter(({ key, ir }) =>
      [key, ir.meta?.name ?? '', ir.meta?.description ?? ''].some((text) =>
        text.toLowerCase().includes(needle)
      )
    );
  }, [items, query]);

  const { data: reports } = useQuery({
    queryKey: ['reports'],
    queryFn: async () => (await config.stats?.reports?.()) ?? [],
    enabled: config.stats?.reports !== undefined,
  });

  const openEdit = (key: string) => {
    const found = items.find((item) => item.key === key);
    if (found === undefined) return;
    const meta = found.ir.meta;
    const original = { name: meta?.name ?? '', description: meta?.description ?? '' };
    setEditing({ key, loc: meta?.loc, ...original, original });
  };

  /* Only the fields that changed are written back, one write-back call each. */
  const saveEdit = () => {
    if (editing?.loc === undefined) return;
    const { loc, name, description, original } = editing;
    const run = async () => {
      if (name !== original.name) {
        await studioPost('/__studio/node', { ...loc, path: '1.name', value: name });
      }
      if (description !== original.description) {
        await studioPost('/__studio/node', { ...loc, path: '1.description', value: description });
      }
    };
    void reportSave(run(), { saved: t('inspector.saved'), failed: t('inspector.saveFailed') });
    setEditing(undefined);
  };

  if (items.length === 0) {
    return (
      <div className="text-muted flex h-full items-center justify-center text-sm">
        {t('workflows.empty')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageChrome
        breadcrumb={<Breadcrumb items={[{ label: t('nav.workflows') }]} />}
        actions={
          <SearchInput
            className="w-64"
            placeholder={t('workflows.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
      />
      <div className="min-h-0 flex-1">
        {filtered.length === 0 ? (
          <div className="text-muted flex h-full items-center justify-center text-sm">
            {t('workflows.noMatches', { query: query.trim() })}
          </div>
        ) : (
          <WorkflowList
            items={filtered}
            {...(reports !== undefined ? { reports } : {})}
            onOpen={(key) => void navigate({ to: '/workflows/$name', params: { name: key } })}
            onEdit={openEdit}
          />
        )}
      </div>

      <Modal
        visible={editing !== undefined}
        onCancel={() => setEditing(undefined)}
        className="w-100 p-6"
      >
        <ModalTitle>{t('workflows.editTitle')}</ModalTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveEdit();
          }}
        >
          <label className="mt-5 block">
            <span className="text-secondary mb-1.5 block text-sm">{t('common.name')}</span>
            <Input
              className="w-full"
              value={editing?.name ?? ''}
              onChange={(e) => setEditing((draft) => draft && { ...draft, name: e.target.value })}
            />
          </label>
          <label className="mt-4 block">
            <span className="text-secondary mb-1.5 block text-sm">{t('common.description')}</span>
            <Textarea
              rows={3}
              className="w-full"
              value={editing?.description ?? ''}
              onChange={(e) =>
                setEditing((draft) => draft && { ...draft, description: e.target.value })
              }
            />
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" type="submit" disabled={editing?.loc === undefined}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export const workflowsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows',
  component: WorkflowsIndex,
});

/* --------------------------- Detail (tabbed shell) -------------------------- */

const TABS = [
  { to: '/workflows/$name', label: 'workflows.tabs.overview', exact: true },
  { to: '/workflows/$name/workflow', label: 'workflows.tabs.canvas', exact: true },
] as const;

function WorkflowDetail() {
  const { name } = workflowDetailRoute.useParams();
  const { config } = workflowDetailRoute.useRouteContext();
  const pathname = useLocation({ select: (location) => location.pathname });
  /* Both tab paths are exact, so the active one is whichever equals the URL. */
  const activeTab =
    TABS.find((tab) => tab.to.replace('$name', name) === decodeURIComponent(pathname)) ?? TABS[0];
  const { t } = useTranslation();

  const ir = lookup(config.workflows, name)?.toIR();

  /* Switcher options: every workflow in the project, labelled by its meta name. */
  const options = useMemo(
    () =>
      Object.entries(config.workflows).map(([key, builder]) => ({
        value: key,
        label: displayName(builder.toIR().meta?.name, t('common.untitled')),
      })),
    [config, t]
  );

  if (ir === undefined) {
    return (
      <div className="text-muted flex h-full flex-col items-center justify-center gap-3 text-sm">
        <p>{t('workflows.notFound', { name })}</p>
        <Link to="/workflows" className="text-primary underline">
          {t('common.back')}
        </Link>
      </div>
    );
  }

  /*
   * The header is the root's. This view contributes a breadcrumb whose leaf is
   * the workflow switcher, and Publish on the right; the view tabs sit at the
   * top-left of the content, where switching a view belongs.
   */
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageChrome
        breadcrumb={
          <Breadcrumb
            items={[
              { label: t('nav.workflows'), to: '/workflows' },
              {
                label: options.find((option) => option.value === name)?.label ?? name,
                to: '/workflows/$name',
                params: { name },
              },
              { label: t(activeTab.label) },
            ]}
          />
        }
        actions={
          /* A pill: full radius, and corner-shape reset to round — the studio's
             superellipse would flatten a pill's ends. */
          <Button
            size="sm"
            variant="default"
            className="gap-1.5 rounded-full pr-4 pl-3"
            style={{ cornerShape: 'round' } as CSSProperties}
          >
            <Rocket className="size-4" strokeWidth={2} aria-hidden />
            {t('common.publish')}
          </Button>
        }
      />
      <div className="px-6 py-3">
        <Tabs
          className="w-fit"
          items={TABS.map((tab) => ({ to: tab.to, label: t(tab.label), exact: tab.exact }))}
          params={{ name }}
        />
      </div>

      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export const workflowDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/$name',
  component: WorkflowDetail,
});

/* --------------------------------- Canvas --------------------------------- */

const SELECTION_KEY = 'workflow-ui:canvas-selection';

function CanvasTab() {
  const { name } = workflowDetailRoute.useParams();
  const { config } = workflowDetailRoute.useRouteContext();
  const navigate = useNavigate();
  const { resolved } = useTheme();
  const { t } = useTranslation();
  /*
   * Selection outlives the write-back reload. Saving edits a file, which
   * full-reloads the page; without this the panel you just saved from vanishes
   * and you lose your place. Same trick as the pending toast, same reason.
   */
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    typeof sessionStorage === 'undefined'
      ? undefined
      : (sessionStorage.getItem(`${SELECTION_KEY}:${name}`) ?? undefined)
  );
  const select = useCallback(
    (id: string | undefined) => {
      setSelectedId(id);
      const key = `${SELECTION_KEY}:${name}`;
      if (id === undefined) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, id);
    },
    [name]
  );

  const ir = lookup(config.workflows, name)?.toIR();
  const selected =
    ir !== undefined && selectedId !== undefined ? findNode(ir, selectedId) : undefined;
  const loc = selected?.meta?.loc;

  const { data: stats } = useQuery({
    queryKey: ['node-stats', ir?.name],
    queryFn: async () => (await config.stats?.nodeStats?.(ir?.name ?? '')) ?? {},
    enabled: ir !== undefined && config.stats?.nodeStats !== undefined,
  });

  /*
   * The DSL records where each node was built, but in the position of the
   * module Vite served — the dev server owns the source map that turns that
   * back into a line on disk, so resolving it is a round trip, not a lookup.
   * One probe per field: whether a literal backs the value is a fact about that
   * exact slot, and only the server can see it.
   */
  /* A condition's fields carry their own call site; a node's default to the node's. */
  const fields = selected === undefined ? [] : fieldsOf(selected);
  const locOf = (field: EditableField) => field.loc ?? loc;
  const slotOf = (field: EditableField) => `${field.scope ?? ''}:${field.path.join('.')}`;
  /* One call site can build many nodes; the panel says so before you edit it. */
  const sharedBy =
    ir !== undefined && loc !== undefined
      ? nodesPerSourcePosition(ir).get(`${loc.file}:${loc.line}:${loc.column}`)
      : undefined;
  const probes = useQueries({
    queries: fields.map((field) => ({
      queryKey: ['node-source', locOf(field), field.path.join('.')],
      queryFn: () =>
        studioGet<NodeSource>('/__studio/node', {
          ...locOf(field),
          path: field.path.join('.'),
        }),
      enabled: locOf(field) !== undefined,
    })),
  });

  const sources: Record<string, NodeSource> = {};
  fields.forEach((field, index) => {
    const data = probes[index]?.data;
    if (data !== undefined) sources[slotOf(field)] = data;
  });

  if (ir === undefined) return null;

  return (
    <div className="border-border relative h-full min-h-0 border-t">
      <div className="h-full">
        <WorkflowCanvas
          key={name}
          ir={ir}
          colorMode={resolved}
          {...(stats !== undefined ? { stats } : {})}
          selectedId={selectedId}
          onSelectNode={select}
          onOpenTemplate={(key) => void navigate({ to: '/templates/$key', params: { key } })}
        />
      </div>
      {/*
        Floating, not docked: a docked column resizes the canvas every time a
        node is picked, which shifts the drawing under the cursor. Over the
        canvas, the drawing stays put and the card is dismissable in place.
        Capped to the pane's height so a long inspector scrolls inside itself.
        z-10 clears react-flow's own panels (controls sit at z-5).
      */}
      {selected !== undefined && (
        <div className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-2rem)]">
          <NodeInspector
            node={selected}
            sources={sources}
            {...(sharedBy !== undefined ? { sharedBy } : {})}
            onClose={() => select(undefined)}
            onSave={(field: EditableField, value: string) =>
              reportSave(
                studioPost('/__studio/node', {
                  ...locOf(field),
                  path: field.path.join('.'),
                  value,
                }),
                {
                  saved: t('inspector.saved'),
                  failed: t('inspector.saveFailed'),
                }
              )
            }
          />
        </div>
      )}
    </div>
  );
}

export const workflowCanvasRoute = createRoute({
  getParentRoute: () => workflowDetailRoute,
  path: '/workflow',
  component: CanvasTab,
});
