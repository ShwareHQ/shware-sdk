import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, createRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Breadcrumb } from '../../components/breadcrumb';
import { EmailThumbnail } from '../../components/email-thumbnail';
import { SearchInput } from '../../components/input/search-input';
import { NodeInspector, type NodeSource } from '../../components/node-inspector';
import { PushThumbnail } from '../../components/push-thumbnail';
import { Tabs } from '../../components/tabs';
import { findNode } from '../../components/template-refs';
import { WorkflowCanvas } from '../../components/workflow-canvas';
import { WorkflowList } from '../../components/workflow-list';
import { displayName } from '../../utils/label';
import { lookup } from '../../utils/lookup';
import { formatIssues, resolvePush } from '../../utils/template-content';
import { useEmailPreview } from '../email-preview';
import { useTheme } from '../integrations/theme/root-provider';
import { PageChrome } from '../page-chrome';
import { studioGet } from '../studio';
import { Route as rootRoute } from './__root';

/* ---------------------------------- List ---------------------------------- */

function WorkflowsIndex() {
  const { config } = workflowsIndexRoute.useRouteContext();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const items = useMemo(
    () => Object.entries(config.workflows).map(([key, ir]) => ({ key, ir })),
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

  if (items.length === 0) {
    return (
      <div className="text-muted flex flex-1 items-center justify-center text-sm">
        {t('workflows.empty')}
      </div>
    );
  }

  return (
    /* Nothing here scrolls: the shell's content column is the one scrollport. */
    <div className="flex-1">
      <PageChrome breadcrumb={<Breadcrumb items={[{ label: t('nav.workflows') }]} />} />
      {/*
        The search field belongs with what it filters, not up in the chrome.
        It scrolls away with the list: only the app header pins, and a stack
        of three fixed bars over a short list was more chrome than content.
      */}
      <div className="px-6 pt-4 pb-3">
        <SearchInput
          className="w-72"
          placeholder={t('workflows.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="px-6 pb-6">
        {filtered.length === 0 ? (
          <div className="text-muted flex items-center justify-center py-24 text-sm">
            {t('workflows.noMatches', { query: query.trim() })}
          </div>
        ) : (
          <WorkflowList
            items={filtered}
            {...(reports !== undefined ? { reports } : {})}
            onOpen={(key) => void navigate({ to: '/workflows/$id', params: { id: key } })}
          />
        )}
      </div>
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
  { to: '/workflows/$id', label: 'workflows.tabs.overview', exact: true },
  { to: '/workflows/$name/workflow', label: 'workflows.tabs.canvas', exact: true },
] as const;

function WorkflowDetail() {
  const { id } = workflowDetailRoute.useParams();
  const { config } = workflowDetailRoute.useRouteContext();
  const pathname = useLocation({ select: (location) => location.pathname });
  /* Both tab paths are exact, so the active one is whichever equals the URL. */
  const activeTab =
    TABS.find((tab) => tab.to.replace('$id', id) === decodeURIComponent(pathname)) ?? TABS[0];
  const { t } = useTranslation();

  const ir = lookup(config.workflows, id);

  /* Switcher options: every workflow in the project, labelled by its meta name. */
  const options = useMemo(
    () =>
      Object.entries(config.workflows).map(([key, ir]) => ({
        value: key,
        label: displayName(ir.meta?.name, t('common.untitled')),
      })),
    [config, t]
  );

  if (ir === undefined) {
    return (
      <div className="text-muted flex flex-1 flex-col items-center justify-center gap-3 text-sm">
        <p>{t('workflows.notFound', { id })}</p>
        <Link to="/workflows" className="text-primary underline">
          {t('common.back')}
        </Link>
      </div>
    );
  }

  /*
   * The header is the root's. This view contributes a breadcrumb whose leaf is
   * the workflow switcher; the view tabs sit at the top-left of the content,
   * where switching a view belongs.
   */
  return (
    <div className="flex flex-1 flex-col">
      <PageChrome
        breadcrumb={
          <Breadcrumb
            items={[
              { label: t('nav.workflows'), to: '/workflows' },
              {
                label: options.find((option) => option.value === id)?.label ?? id,
                to: '/workflows/$id',
                params: { id },
              },
              { label: t(activeTab.label) },
            ]}
          />
        }
      />
      <div className="px-6 py-3">
        <Tabs
          className="w-fit"
          items={TABS.map((tab) => ({ to: tab.to, label: t(tab.label), exact: tab.exact }))}
          params={{ id }}
        />
      </div>

      {/*
        `min-h-0` only for the canvas. Every other tab is a document that
        grows and scrolls with the shell; the canvas must stay inside the
        viewport because react-flow owns pan and zoom within a fixed frame and
        the floating inspector's max-h hangs off that frame's height.
      */}
      <div className={clsx('flex flex-1 flex-col', activeTab === TABS[1] && 'min-h-0')}>
        <Outlet />
      </div>
    </div>
  );
}

export const workflowDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/$id',
  component: WorkflowDetail,
});

/* --------------------------------- Canvas --------------------------------- */

const SELECTION_KEY = 'workflow-ui:canvas-selection';

function CanvasTab() {
  const { id } = workflowDetailRoute.useParams();
  const { config } = workflowDetailRoute.useRouteContext();
  const navigate = useNavigate();
  const { resolved } = useTheme();
  /*
   * Selection outlives a reload. Editing a workflow in the editor can
   * full-reload the page; without this the panel you were reading vanishes and
   * you lose your place.
   */
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    typeof sessionStorage === 'undefined'
      ? undefined
      : (sessionStorage.getItem(`${SELECTION_KEY}:${id}`) ?? undefined)
  );
  const select = useCallback(
    (id: string | undefined) => {
      setSelectedId(id);
      const key = `${SELECTION_KEY}:${id}`;
      if (id === undefined) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, id);
    },
    [id]
  );

  const ir = lookup(config.workflows, id);
  const selected =
    ir !== undefined && selectedId !== undefined ? findNode(ir, selectedId) : undefined;
  const loc = selected?.meta?.loc;

  const { data: stats } = useQuery({
    queryKey: ['node-stats', ir?.id],
    queryFn: async () => (await config.stats?.nodeStats?.(ir?.id ?? '')) ?? {},
    enabled: ir !== undefined && config.stats?.nodeStats !== undefined,
  });

  /*
   * The DSL records where each node was built, but in the position of the
   * module Vite served — the dev server owns the source map that turns that
   * back into a line on disk, so resolving it is a round trip, not a lookup.
   * Navigation only: a failed lookup leaves the source row out and nothing
   * else waits on it.
   */
  const { data: source } = useQuery({
    queryKey: ['node-source', loc],
    queryFn: () => studioGet<NodeSource>('/__studio/node', { ...loc }),
    enabled: loc !== undefined,
    retry: false,
  });

  /*
   * A message node shows what it sends, rendered from the template's own
   * validated `preview` — the same props, the same render and the same
   * failure the templates page shows. Email is the one channel with a
   * document; the query is keyed like the templates page's, so a template
   * seen there (or here) is already rendered for the other.
   */
  const message = selected?.type === 'message' ? selected : undefined;
  const emailModule =
    message?.channel === 'email' ? lookup(config.emails, message.template) : undefined;
  const emailPreview = useEmailPreview(emailModule, message?.template ?? '');
  /* A push has no document: its notification is drawn into the OS banner. */
  const pushModule =
    message?.channel === 'push' ? lookup(config.pushes, message.template) : undefined;
  const push =
    message !== undefined && pushModule !== undefined
      ? resolvePush(pushModule, message.template)
      : undefined;

  if (ir === undefined) return null;

  const openTemplate = () => {
    if (message !== undefined)
      void navigate({
        to: '/templates/$key',
        params: { key: message.template },
        search: { channel: message.channel },
      });
  };
  let preview: ReactNode;
  if (message?.channel === 'email') {
    preview = (
      <EmailThumbnail
        html={emailPreview.data?.status === 'ok' ? emailPreview.data.html : undefined}
        loading={emailModule !== undefined && emailPreview.isPending}
        error={
          emailPreview.data?.status === 'invalid'
            ? formatIssues(emailPreview.data.failure)
            : emailPreview.error?.message
        }
        registered={emailModule !== undefined}
        scheme={resolved}
        onOpen={openTemplate}
      />
    );
  } else if (message?.channel === 'push') {
    preview = (
      <PushThumbnail
        appName={config.title ?? 'App'}
        title={push?.ok === true ? (push.push.title ?? message.template) : message.template}
        body={push?.ok === true ? push.push.body : ''}
        {...(push?.ok === false ? { error: formatIssues(push.failure) } : {})}
        registered={pushModule !== undefined}
        scheme={resolved}
        onOpen={openTemplate}
      />
    );
  }

  return (
    /* The exception to the shell's one-scrollport rule: this pane is pinned to
       the viewport rather than growing the page. */
    <div className="border-border relative flex min-h-0 flex-1 flex-col border-t">
      {/*
        Absolute rather than a flex child: the shell's main column is sized by
        min-height, so its height is `auto` and the canvas's own `height: 100%`
        has nothing definite to resolve against — it collapses to zero. Filling
        an already-positioned parent sidesteps percentage resolution entirely.
      */}
      <div className="absolute inset-0">
        <WorkflowCanvas
          key={id}
          ir={ir}
          colorMode={resolved}
          {...(stats !== undefined ? { stats } : {})}
          selectedId={selectedId}
          onSelectNode={select}
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
            {...(source !== undefined ? { source } : {})}
            {...(preview !== undefined ? { preview } : {})}
            onClose={() => select(undefined)}
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
