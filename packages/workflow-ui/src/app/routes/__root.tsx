import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { clsx } from 'clsx';
import type { i18n as I18n } from 'i18next';
import { Home, Mail, Settings, Users, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { superellipse } from '../../components/corner-shape';
import type { WorkflowUIConfig } from '../../config';
import { ToastProvider } from '../integrations/toast/toast-provider';

/**
 * Shell: one full-height sidebar down the left, carrying the brand at its top,
 * with the active view filling everything to its right. Each view brings its
 * own header, so there is no second bar across the top competing with it.
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
  const { t } = useTranslation();

  return (
    <div className="flex h-full font-sans text-gray-900">
      <aside className="flex w-52 shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gray-900"
            style={superellipse}
          >
            <Workflow className="size-4 text-white" strokeWidth={2} />
          </div>
          <strong className="text-sm font-semibold">Workflow Studio</strong>
        </div>

        <nav className="flex flex-col gap-1.5 p-3 pt-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact }}
              className={clsx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium',
                'text-gray-600 transition-colors hover:bg-gray-100'
              )}
              activeProps={{ className: '!bg-gray-900 !text-white' }}
              style={superellipse}
            >
              <item.icon className="size-4 shrink-0" strokeWidth={2} />
              {t(item.label)}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 bg-gray-50">
        <Outlet />
      </main>

      <ToastProvider />
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});
