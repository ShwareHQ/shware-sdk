import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { clsx } from 'clsx';
import type { i18n as I18n } from 'i18next';
import { Home, Mail, PanelLeftClose, PanelLeftOpen, Settings, Users, Workflow } from 'lucide-react';
import { useCallback, useState } from 'react';
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

const COLLAPSED_KEY = 'workflow-ui-sidebar-collapsed';

/**
 * Read synchronously in the initializer, not in an effect: the sidebar's width
 * is layout, so recovering it a frame late would shove the whole view sideways
 * on every load.
 */
const readCollapsed = () =>
  typeof localStorage !== 'undefined' && localStorage.getItem(COLLAPSED_KEY) === 'true';

function RootLayout() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((open) => {
      localStorage.setItem(COLLAPSED_KEY, String(!open));
      return !open;
    });
  }, []);

  /*
   * Collapsed, a nav item is a square icon button and the label moves into the
   * tooltip — the canvas is the view that most wants the width back, and it is
   * also the one where the icons alone are unambiguous.
   */
  const itemClass = clsx(
    'flex items-center rounded-lg text-[13px] font-medium',
    'text-secondary hover:bg-hover transition-colors',
    collapsed ? 'size-9 justify-center' : 'gap-2.5 px-3 py-2'
  );

  return (
    <div className="text-primary flex h-full font-sans">
      <aside
        className={clsx(
          'border-border bg-card flex shrink-0 flex-col border-r transition-[width] duration-150',
          collapsed ? 'w-14' : 'w-52'
        )}
      >
        <div
          className={clsx(
            'flex h-14 shrink-0 items-center gap-2.5',
            collapsed ? 'justify-center px-0' : 'px-4'
          )}
        >
          <div
            className="bg-primary flex size-7 shrink-0 items-center justify-center rounded-lg"
            style={superellipse}
          >
            <Workflow className="text-card size-4" strokeWidth={2} />
          </div>
          {!collapsed && <strong className="text-sm font-semibold">Workflow Studio</strong>}
        </div>

        <nav
          className={clsx(
            'flex flex-1 flex-col gap-1.5 pt-1',
            collapsed ? 'items-center px-0' : 'p-3'
          )}
        >
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact }}
              className={itemClass}
              activeProps={{ className: '!bg-selected !text-primary' }}
              style={superellipse}
              title={collapsed ? t(item.label) : undefined}
            >
              <item.icon className="size-4 shrink-0" strokeWidth={2} />
              {!collapsed && t(item.label)}
            </Link>
          ))}
        </nav>

        {/* Bottom rail: the toggle is the same shape as a nav item, so collapsing does not move it. */}
        <div className={clsx('flex', collapsed ? 'justify-center pb-3' : 'p-3')}>
          <button
            type="button"
            onClick={toggle}
            className={itemClass}
            style={superellipse}
            title={collapsed ? t('nav.expand') : undefined}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 shrink-0" strokeWidth={2} />
            ) : (
              <PanelLeftClose className="size-4 shrink-0" strokeWidth={2} />
            )}
            {!collapsed && t('nav.collapse')}
          </button>
        </div>
      </aside>

      <main className="bg-page min-h-0 min-w-0 flex-1">
        <Outlet />
      </main>

      <ToastProvider />
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});
