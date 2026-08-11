import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { superellipse } from '../../components/corner-shape';
import { METRIC_SERIES, MetricsChart } from '../../components/metrics-chart';
import { workflowDetailRoute } from './workflows';

const number = (value: number) => value.toLocaleString();

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-card rounded-2xl border px-4 py-3" style={superellipse}>
      <div className="text-muted text-xs">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function MetricsTab() {
  const { name } = workflowDetailRoute.useParams();
  const { config } = workflowDetailRoute.useRouteContext();
  const { t } = useTranslation();

  const ir = config.workflows[name]?.toIR();
  const workflowName = ir?.name ?? '';

  const { data: points } = useQuery({
    queryKey: ['metrics', workflowName],
    queryFn: async () => (await config.stats?.metrics?.(workflowName)) ?? [],
    enabled: ir !== undefined && config.stats?.metrics !== undefined,
  });

  const { data: reports } = useQuery({
    queryKey: ['reports'],
    queryFn: async () => (await config.stats?.reports?.()) ?? [],
    enabled: config.stats?.reports !== undefined,
  });

  const report = reports?.find((row) => row.name === workflowName);

  if (config.stats?.metrics === undefined && config.stats?.reports === undefined) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div
          className="border-border bg-card max-w-md rounded-2xl border border-dashed p-8 text-center"
          style={superellipse}
        >
          <p className="text-sm font-medium">{t('metrics.noSource')}</p>
          <p className="text-muted mt-2 text-sm">{t('metrics.noSourceHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t('metrics.entered')} value={report ? number(report.entered) : '—'} />
        <Stat label={t('metrics.active')} value={report ? number(report.active) : '—'} />
        <Stat label={t('metrics.completed')} value={report ? number(report.completed) : '—'} />
        <Stat label={t('metrics.converted')} value={report ? number(report.converted) : '—'} />
        <Stat
          label={t('metrics.conversionRate')}
          value={
            report && report.entered > 0
              ? `${((report.converted / report.entered) * 100).toFixed(1)}%`
              : '—'
          }
        />
      </div>

      <section className="border-border bg-card mt-6 rounded-2xl border p-5" style={superellipse}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('metrics.overTime')}</h2>
          <div className="flex items-center gap-4">
            {METRIC_SERIES.map((series) => (
              <span key={series.key} className="text-secondary flex items-center gap-1.5 text-xs">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: series.color }}
                  aria-hidden
                />
                {t(`metrics.${series.key}`)}
              </span>
            ))}
          </div>
        </div>

        {points && points.length > 0 ? (
          <div className="mt-4">
            <MetricsChart points={points} />
          </div>
        ) : (
          <p className="text-muted mt-6 text-sm">{t('metrics.noData')}</p>
        )}
      </section>
    </div>
  );
}

export const workflowMetricsRoute = createRoute({
  getParentRoute: () => workflowDetailRoute,
  path: '/metrics',
  component: MetricsTab,
});
