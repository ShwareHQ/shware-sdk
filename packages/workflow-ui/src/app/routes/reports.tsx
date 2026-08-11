import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { ReportsPage } from '../../components/reports-page';
import { Route as rootRoute } from './__root';

function ReportsView() {
  const { config } = reportsRoute.useRouteContext();
  const load = config.stats?.reports;

  const { data, isPending } = useQuery({
    queryKey: ['reports'],
    queryFn: async () => (await load?.()) ?? [],
    enabled: load !== undefined,
  });

  return (
    <ReportsPage
      configured={load !== undefined}
      loading={load !== undefined && isPending}
      {...(data !== undefined ? { rows: data } : {})}
      workflowNames={Object.values(config.workflows).map((builder) => builder.toIR().name)}
    />
  );
}

export const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: ReportsView,
});
