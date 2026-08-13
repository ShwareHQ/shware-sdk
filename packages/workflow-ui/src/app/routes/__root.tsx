import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { clsx } from 'clsx';
import type { i18n as I18n } from 'i18next';
import { Home, Mail, PanelLeftClose, PanelLeftOpen, Settings, Users, Workflow } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { superellipse } from '../../components/corner-shape';
import type { ResolvedStudioConfig } from '../../config';
import { raisePendingToast } from '../integrations/toast/pending';
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
  config: ResolvedStudioConfig;
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

  // A save's confirmation survives the write-back reload (see pending.ts)
  useEffect(raisePendingToast, []);

  const toggle = useCallback(() => {
    setCollapsed((open) => {
      localStorage.setItem(COLLAPSED_KEY, String(!open));
      return !open;
    });
  }, []);

  /*
   * Identical padding in both states, so the icon sits at the same x whether the
   * rail is open or shut and the collapse animates as pure width. Centring the
   * icon instead would apply the moment the class flips, throwing it to the
   * middle of a still-full-width panel and then dragging it back left as the
   * width caught up — the animation read as a bounce.
   *
   * That fixes the rail's width too: 12px of nav padding + 12px of item padding
   * + a 16px icon + 12px, i.e. 64px, is what leaves the icon centred once shut.
   *
   * The height is pinned for the same reason it is not padded: with `py-2` the
   * box was as tall as its content, so losing the label shrank every item by
   * 4px the instant the state flipped.
   */
  const itemClass = clsx(
    'flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium',
    'text-secondary hover:bg-hover overflow-hidden whitespace-nowrap transition-colors'
  );

  return (
    <div className="text-primary flex h-full font-sans">
      <aside
        className={clsx(
          'border-border bg-card flex shrink-0 flex-col overflow-hidden border-r',
          'transition-[width] duration-200 ease-out',
          collapsed ? 'w-16' : 'w-52'
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
          <div
            className="bg-primary flex size-7 shrink-0 items-center justify-center rounded-lg"
            style={superellipse}
          >
            <Workflow className="text-card size-4" strokeWidth={2} />
          </div>
          {!collapsed && (
            <strong className="text-sm font-semibold whitespace-nowrap">Workflow Studio</strong>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-1.5 p-3 pt-1">
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

        {/*
          Bottom rail: the toggle is the same shape as a nav item, so collapsing
          does not move it. flex-col, like the nav above, so the button stretches
          to the rail's width — as a row-direction flex item it would size to its
          own text and its hover fill would stop short of the edges.
        */}
        <div className="flex flex-col p-3">
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
