import { useQuery } from '@tanstack/react-query';
import { Link, createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { WorkflowCanvas } from '../../components/workflow-canvas';
import { HeaderSlot } from '../header-slot';
import { Route as rootRoute } from './__root';

/** `/workflows` picks the first definition, so the tab always lands somewhere. */
export const workflowsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows',
  beforeLoad: ({ context }) => {
    const [first] = Object.keys(context.config.workflows);
    if (first !== undefined) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({ to: '/workflows/$name', params: { name: first } });
    }
  },
  component: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">
      No workflows exported from workflow.config.ts
    </div>
  ),
});

function WorkflowView() {
  const { name } = workflowRoute.useParams();
  const { config } = workflowRoute.useRouteContext();
  const navigate = useNavigate();

  const builder = config.workflows[name];
  const ir = builder?.toIR();

  /** Node badges: the user's own stats source, so failures surface as a toast. */
  const { data: stats } = useQuery({
    queryKey: ['node-stats', ir?.name],
    queryFn: async () => (await config.stats?.nodeStats?.(ir?.name ?? '')) ?? {},
    enabled: ir !== undefined && config.stats?.nodeStats !== undefined,
  });

  if (ir === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
        <p>
          No workflow named <code className="font-mono text-slate-700">{name}</code>
        </p>
        <Link to="/workflows" className="text-slate-900 underline">
          Back to the first workflow
        </Link>
      </div>
    );
  }

  return (
    <>
      <HeaderSlot>
        <select
          value={name}
          onChange={(event) =>
            void navigate({ to: '/workflows/$name', params: { name: event.target.value } })
          }
          className="rounded-md border border-slate-300 px-2 py-1 text-[13px]"
        >
          {Object.keys(config.workflows).map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
        <span className="shrink-0 font-mono text-xs text-slate-500">
          {ir.name} · v{ir.irVersion} · #{ir.contentHash.slice(0, 8)}
        </span>
        {ir.meta?.description !== undefined && (
          <span className="truncate text-xs text-slate-500">{ir.meta.description}</span>
        )}
      </HeaderSlot>

      <WorkflowCanvas
        key={name}
        ir={ir}
        {...(stats !== undefined ? { stats } : {})}
        onOpenTemplate={(key) => void navigate({ to: '/templates/$key', params: { key } })}
      />
    </>
  );
}

export const workflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/$name',
  component: WorkflowView,
});
