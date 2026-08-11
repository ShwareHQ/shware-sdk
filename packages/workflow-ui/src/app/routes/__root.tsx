import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { clsx } from 'clsx';
import type { i18n as I18n } from 'i18next';
import { Home, Mail, Settings, Users, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkflowUIConfig } from '../../config';
import { ToastProvider } from '../integrations/toast/toast-provider';

/**
 * Shell: a header across the top and a full-height sidebar down the left.
 *
 * Routes are defined in code rather than by file convention. The studio ships
 * inside a package, so a file-based `routeTree.gen.ts` would have to be written
 * into the consumer's node_modules at dev time — code-based routing keeps the
 * package read-only.
 */
export interface RouterContext {
  queryClient: QueryClient;
  config: WorkflowUIConfig;
  i18n: I18n;
}

const NAV = [
  { to: '/', label: 'nav.home', icon: Home, exact: true },
  { to: '/workflows', label: 'nav.workflows', icon: Workflow, exact: false },
  { to: '/segments', label: 'nav.segments', icon: Users, exact: false },
  { to: '/emails', label: 'nav.emails', icon: Mail, exact: false },
  { to: '/settings', label: 'nav.settings', icon: Settings, exact: true },
] as const;

function RootLayout() {
  const { config } = Route.useRouteContext();
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col font-sans text-slate-900">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex size-7 items-center justify-center rounded-lg bg-slate-900">
          <Workflow className="size-4 text-white" strokeWidth={2} />
        </div>
        <strong className="text-sm font-semibold">{config.title ?? 'Workflow Studio'}</strong>
        <div id="studio-header-slot" className="flex min-w-0 flex-1 items-center gap-3" />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-slate-200 bg-white p-3">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact }}
              className={clsx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium',
                'text-slate-600 transition-colors hover:bg-slate-100'
              )}
              activeProps={{ className: '!bg-slate-900 !text-white' }}
            >
              <item.icon className="size-4 shrink-0" strokeWidth={2} />
              {t(item.label)}
            </Link>
          ))}
        </aside>

        <main className="min-h-0 min-w-0 flex-1 bg-slate-50">
          <Outlet />
        </main>
      </div>

      <ToastProvider />
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});
