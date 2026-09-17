import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { clsx } from 'clsx';
import type { i18n as I18n } from 'i18next';
import {
  Home,
  LayoutTemplate,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
  Workflow,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { superellipse } from '../../components/corner-shape';
import type { ResolvedStudioConfig } from '../../config';
import { raisePendingToast } from '../integrations/toast/pending';
import { ToastProvider } from '../integrations/toast/toast-provider';
import { PageChromeProvider, useChromeSlotRef } from '../page-chrome';

/**
 * Shell: one full-height sidebar down the left, carrying the brand at its top,
 * and one header across the top of everything to its right. The header is the
 * only bar: sidebar toggle, then a breadcrumb saying where you are, an optional
 * centred title, and the view's actions on the right. Views fill it through
 * PageChrome rather than drawing bars of their own, so every page reads the
 * same way and the toggle is reachable whether the rail is open or shut.
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
  { to: '/templates', label: 'nav.templates', icon: LayoutTemplate, exact: false },
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
  return (
    <PageChromeProvider>
      <Shell />
    </PageChromeProvider>
  );
}

/**
 * The header's three tracks: [toggle + breadcrumb] [title] [actions]. Equal
 * outer tracks keep the title dead-centre while space allows and squeeze the
 * sides — never overlap them — when it does not.
 */
function Header({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const breadcrumbRef = useChromeSlotRef('breadcrumb');
  const titleRef = useChromeSlotRef('title');
  const actionsRef = useChromeSlotRef('actions');

  return (
    <header className="border-border bg-card grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={t(collapsed ? 'nav.expand' : 'nav.collapse')}
          title={t(collapsed ? 'nav.expand' : 'nav.collapse')}
          className="text-muted hover:bg-hover hover:text-primary flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
          style={superellipse}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" strokeWidth={2} />
          ) : (
            <PanelLeftClose className="size-4" strokeWidth={2} />
          )}
        </button>
        <div ref={breadcrumbRef} className="flex min-w-0 items-center" />
      </div>
      {/*
        Never hidden when empty. display:none takes the title out of the grid,
        and the actions div then auto-places into this auto-sized track instead
        of the right-hand one — Publish ends up hugging the breadcrumb. Empty,
        the auto track is 0px, which is all "hidden" would have bought.
      */}
      <div ref={titleRef} className="text-sm font-semibold" />
      <div ref={actionsRef} className="flex items-center justify-end gap-2" />
    </header>
  );
}

function Shell() {
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
    'flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium',
    'text-secondary hover:bg-hover overflow-hidden whitespace-nowrap transition-colors'
  );

  return (
    <div className="text-primary flex h-full font-sans">
      <aside
        className={clsx(
          'border-border bg-card flex shrink-0 flex-col overflow-hidden border-r',
          'transition-[width] duration-200 ease-out',
          collapsed ? 'w-16' : 'w-60'
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

        <nav className="flex flex-col gap-1.5 p-3 pt-1">
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
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header collapsed={collapsed} onToggle={toggle} />
        <main className="bg-page min-h-0 min-w-0 flex-1">
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
