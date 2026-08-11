import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { clsx } from 'clsx';
import type { WorkflowUIConfig } from '../../config';
import { ToastProvider } from '../integrations/toast/toast-provider';

/**
 * Root layout: header, tabs, and the outlet the three views render into.
 *
 * Routes are defined in code rather than by file convention. The studio ships
 * inside a package, so a file-based `routeTree.gen.ts` would have to be written
 * into the consumer's node_modules at dev time — code-based routing keeps the
 * package read-only.
 */
export interface RouterContext {
  queryClient: QueryClient;
  config: WorkflowUIConfig;
}

const TABS = [
  { to: '/workflows', label: 'Workflows' },
  { to: '/templates', label: 'Templates' },
  { to: '/reports', label: 'Reports' },
] as const;

function RootLayout() {
  const { config } = Route.useRouteContext();

  return (
    <div className="flex h-full flex-col font-sans">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2.5">
        <strong className="text-sm font-semibold text-slate-900">
          {config.title ?? 'Workflow Studio'}
        </strong>
        <nav className="flex items-center gap-1">
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className={clsx(
                'rounded-md px-2.5 py-1 text-[13px] transition-colors',
                'text-slate-600 hover:bg-slate-100'
              )}
              activeProps={{ className: '!bg-slate-900 !text-white' }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div id="studio-header-slot" className="flex min-w-0 flex-1 items-center gap-3" />
      </header>

      <main className="min-h-0 flex-1 bg-slate-50">
        <Outlet />
      </main>

      <ToastProvider />
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});
