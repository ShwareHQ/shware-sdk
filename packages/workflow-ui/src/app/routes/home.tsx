import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Breadcrumb } from '../../components/breadcrumb';
import { superellipse } from '../../components/corner-shape';
import { collectTemplateRefs } from '../../components/template-refs';
import { lookup } from '../../utils/lookup';
import { PageChrome } from '../page-chrome';
import { Route as rootRoute } from './__root';
import { collectSegmentRefs } from './segments';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border bg-card rounded-2xl border px-5 py-4" style={superellipse}>
      <div className="text-muted text-xs">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint !== undefined && <div className="text-muted mt-1 text-xs">{hint}</div>}
    </div>
  );
}

function Home() {
  const { config } = homeRoute.useRouteContext();
  const { t } = useTranslation();

  const irs = useMemo(
    () => Object.values(config.workflows).map((builder) => builder.toIR()),
    [config]
  );
  const templateRefs = useMemo(() => collectTemplateRefs(irs), [irs]);
  /* Counted from the IR, not from config.segments, so this agrees with the Segments page. */
  const segmentRefs = useMemo(() => collectSegmentRefs(irs), [irs]);
  /* Each channel reads its own registry, matching the Templates list's badge. */
  const registryFor = (channel: string): Record<string, unknown> => {
    switch (channel) {
      case 'push':
        return config.pushes;
      case 'slack':
        return config.slack;
      case 'discord':
        return config.discord;
      default:
        return config.emails;
    }
  };
  const missing = templateRefs.filter(
    (ref) => lookup(registryFor(ref.channel), ref.key) === undefined
  ).length;

  const { data: reports } = useQuery({
    queryKey: ['reports'],
    queryFn: async () => (await config.stats?.reports?.()) ?? [],
    enabled: config.stats?.reports !== undefined,
  });

  const totals = (reports ?? []).reduce(
    (acc, row) => ({
      entered: acc.entered + row.entered,
      converted: acc.converted + row.converted,
    }),
    { entered: 0, converted: 0 }
  );

  return (
    /* No scroll container of its own: the shell's content column is the only one. */
    <div className="flex-1 p-6">
      <PageChrome breadcrumb={<Breadcrumb items={[{ label: t('nav.home') }]} />} />
      <h1 className="text-lg font-semibold">{t('home.title')}</h1>
      <p className="text-muted mt-1 text-sm">{t('home.subtitle')}</p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label={t('home.workflows')} value={String(irs.length)} />
        <Stat
          label={t('home.templates')}
          value={String(templateRefs.length)}
          {...(missing > 0 ? { hint: t('home.missingTemplates', { count: missing }) } : {})}
        />
        <Stat label={t('home.segments')} value={String(segmentRefs.length)} />
        <Stat label={t('home.entered')} value={reports ? totals.entered.toLocaleString() : '—'} />
        <Stat
          label={t('home.converted')}
          value={reports ? totals.converted.toLocaleString() : '—'}
        />
        <Stat
          label={t('home.conversionRate')}
          value={
            reports && totals.entered > 0
              ? `${((totals.converted / totals.entered) * 100).toFixed(1)}%`
              : '—'
          }
        />
      </div>
    </div>
  );
}

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
});
