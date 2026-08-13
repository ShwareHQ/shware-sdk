import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, createRoute, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { superellipse } from '../../components/corner-shape';
import { WorkflowCanvas } from '../../components/workflow-canvas';
import { WorkflowList } from '../../components/workflow-list';
import { useTheme } from '../integrations/theme/root-provider';
import { Route as rootRoute } from './__root';

/* ---------------------------------- List ---------------------------------- */

function WorkflowsIndex() {
  const { config } = workflowsIndexRoute.useRouteContext();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const items = useMemo(
    () => Object.entries(config.workflows).map(([key, builder]) => ({ key, ir: builder.toIR() })),
    [config]
  );

  const { data: reports } = useQuery({
    queryKey: ['reports'],
    queryFn: async () => (await config.stats?.reports?.()) ?? [],
    enabled: config.stats?.reports !== undefined,
  });

  if (items.length === 0) {
    return (
      <div className="text-muted flex h-full items-center justify-center text-sm">
        {t('workflows.empty')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6 pb-4">
        <h1 className="text-lg font-semibold">{t('workflows.title')}</h1>
      </div>
      <div className="min-h-0 flex-1">
        <WorkflowList
          items={items}
          {...(reports !== undefined ? { reports } : {})}
          onOpen={(key) => void navigate({ to: '/workflows/$name', params: { name: key } })}
        />
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
  { to: '/workflows/$name', label: 'workflows.tabs.canvas', exact: true },
  { to: '/workflows/$name/metrics', label: 'workflows.tabs.metrics', exact: false },
] as const;

function WorkflowDetail() {
  const { name } = workflowDetailRoute.useParams();
  const { config } = workflowDetailRoute.useRouteContext();
  const { t } = useTranslation();

  const ir = config.workflows[name]?.toIR();

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border bg-card flex shrink-0 items-center gap-4 border-b px-6 py-3">
        <Link
          to="/workflows"
          className="text-muted hover:bg-hover flex size-7 items-center justify-center rounded-lg transition-colors"
          style={superellipse}
          aria-label={t('common.back')}
        >
          <ArrowLeft className="size-4" strokeWidth={2} />
        </Link>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{ir.name}</div>
          <div className="text-muted truncate font-mono text-xs">
            v{ir.irVersion} · #{ir.contentHash.slice(0, 8)}
            {ir.meta?.description !== undefined && ` · ${ir.meta.description}`}
          </div>
        </div>
        <nav className="ml-auto flex items-center gap-1">
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              params={{ name }}
              activeOptions={{ exact: tab.exact }}
              className={clsx(
                'text-secondary hover:bg-hover rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors'
              )}
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

export const workflowDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/$name',
  component: WorkflowDetail,
});

/* --------------------------------- Canvas --------------------------------- */

function CanvasTab() {
  const { name } = workflowDetailRoute.useParams();
  const { config } = workflowDetailRoute.useRouteContext();
  const navigate = useNavigate();
  const { resolved } = useTheme();

  const ir = config.workflows[name]?.toIR();

  const { data: stats } = useQuery({
    queryKey: ['node-stats', ir?.name],
    queryFn: async () => (await config.stats?.nodeStats?.(ir?.name ?? '')) ?? {},
    enabled: ir !== undefined && config.stats?.nodeStats !== undefined,
  });

  if (ir === undefined) return null;

  return (
    <WorkflowCanvas
      key={name}
      ir={ir}
      colorMode={resolved}
      {...(stats !== undefined ? { stats } : {})}
      onOpenTemplate={(key) => void navigate({ to: '/emails/$key', params: { key } })}
    />
  );
}

export const workflowCanvasRoute = createRoute({
  getParentRoute: () => workflowDetailRoute,
  path: '/',
  component: CanvasTab,
});
