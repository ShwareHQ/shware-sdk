import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { superellipse } from '../../components/corner-shape';
import { ProfileDrawer } from '../../components/profile-drawer';
import { SeriesChart } from '../../components/series-chart';
import type { Profile } from '../../config';
import { segmentDetailRoute } from './segments';

const PAGE_SIZE = 25;

const number = (value: number) => value.toLocaleString();

/** ISO timestamp → a date; the clock time is noise in a list this dense. */
const day = (iso: string | undefined) => (iso === undefined ? '—' : iso.slice(0, 10));

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-card rounded-2xl border px-4 py-3" style={superellipse}>
      <div className="text-muted text-xs">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/**
 * A segment's Overview: how big it is and how that has moved, then who is
 * actually in it. The chart answers "is this condition matching the population
 * I meant"; the table is how you check that by looking at real people.
 */
function SegmentOverview() {
  const { name } = segmentDetailRoute.useParams();
  const { config } = segmentDetailRoute.useRouteContext();
  const { t } = useTranslation();

  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Profile | undefined>(undefined);

  const { data: reports } = useQuery({
    queryKey: ['segment-reports'],
    queryFn: async () => (await config.stats?.segments?.()) ?? [],
    enabled: config.stats?.segments !== undefined,
  });
  const report = reports?.find((row) => row.name === name);

  const { data: profilePage, isPending } = useQuery({
    queryKey: ['segment-profiles', name, page],
    queryFn: async () =>
      (await config.stats?.profiles?.(name, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })) ?? {
        profiles: [],
        total: 0,
      },
    enabled: config.stats?.profiles !== undefined,
  });

  const series = report?.series ?? [];
  const first = series.at(0);
  const last = series.at(-1);
  const change =
    first !== undefined && last !== undefined && first !== 0
      ? ((last - first) / first) * 100
      : undefined;

  const total = profilePage?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  if (config.stats?.segments === undefined && config.stats?.profiles === undefined) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div
          className="border-border bg-card max-w-md rounded-2xl border border-dashed p-8 text-center"
          style={superellipse}
        >
          <p className="text-sm font-medium">{t('segments.noSource')}</p>
          <p className="text-muted mt-2 text-sm">{t('segments.noSourceHint')}</p>
        </div>
      </div>
    );
  }

  return (
    /* relative: the drawer is absolutely positioned against this pane, not the window */
    <div className="relative h-full overflow-hidden">
      <div className="h-full overflow-auto p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label={t('segments.size')} value={report ? number(report.size) : '—'} />
          <Stat
            label={t('segments.change')}
            value={change === undefined ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}
          />
          <Stat label={t('segments.profiles')} value={total > 0 ? number(total) : '—'} />
        </div>

        <section className="border-border bg-card mt-6 rounded-2xl border p-5" style={superellipse}>
          <h2 className="text-sm font-semibold">{t('segments.overTime')}</h2>
          {series.length > 1 ? (
            <div className="mt-4">
              <SeriesChart values={series} ariaLabel={t('segments.overTime')} />
            </div>
          ) : (
            <p className="text-muted mt-6 text-sm">{t('segments.noData')}</p>
          )}
        </section>

        <section
          className="border-border bg-card mt-6 overflow-hidden rounded-2xl border"
          style={superellipse}
        >
          <div className="border-border flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-sm font-semibold">{t('segments.members')}</h2>
            {total > PAGE_SIZE && (
              <div className="text-muted flex items-center gap-2 text-xs">
                <span className="tabular-nums">
                  {number(page * PAGE_SIZE + 1)}–{number(Math.min((page + 1) * PAGE_SIZE, total))} /{' '}
                  {number(total)}
                </span>
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((current) => current - 1)}
                  className="hover:bg-hover rounded px-2 py-1 transition-colors disabled:opacity-40"
                >
                  {t('common.previous')}
                </button>
                <button
                  type="button"
                  disabled={page >= lastPage}
                  onClick={() => setPage((current) => current + 1)}
                  className="hover:bg-hover rounded px-2 py-1 transition-colors disabled:opacity-40"
                >
                  {t('common.next')}
                </button>
              </div>
            )}
          </div>

          {isPending ? (
            <p className="text-muted p-5 text-sm">{t('common.loading')}</p>
          ) : profilePage === undefined || profilePage.profiles.length === 0 ? (
            <p className="text-muted p-5 text-sm">{t('segments.noProfiles')}</p>
          ) : (
            <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-muted text-left text-xs font-medium">
                  <th className="border-border border-b px-5 py-2">{t('profiles.email')}</th>
                  <th className="border-border w-56 border-b px-5 py-2">{t('profiles.id')}</th>
                  <th className="border-border w-36 border-b px-5 py-2 whitespace-nowrap">
                    {t('profiles.createdAt')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {profilePage.profiles.map((profile) => (
                  <tr
                    key={profile.id}
                    onClick={() => setSelected(profile)}
                    /* The section already draws a rounded edge; a row border on
                       top of it reads as a doubled line. */
                    className="hover:bg-hover cursor-pointer transition-colors last:[&>td]:border-b-0"
                  >
                    <td className="border-border truncate border-b px-5 py-2.5">
                      {profile.email ?? '—'}
                    </td>
                    <td className="border-border text-muted truncate border-b px-5 py-2.5 font-mono text-sm">
                      {profile.id}
                    </td>
                    <td className="border-border text-muted border-b px-5 py-2.5 whitespace-nowrap tabular-nums">
                      {day(profile.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <ProfileDrawer profile={selected} onClose={() => setSelected(undefined)} />
    </div>
  );
}

export const segmentOverviewRoute = createRoute({
  getParentRoute: () => segmentDetailRoute,
  path: '/',
  component: SegmentOverview,
});
