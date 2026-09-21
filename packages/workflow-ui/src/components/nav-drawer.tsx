import { Workflow } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { superellipse } from './corner-shape';

/**
 * The shell's navigation, as a panel over the left edge, for viewports too
 * narrow to give it a column.
 *
 * The rail costs 64px whether or not anyone is looking at it; on a 375px
 * screen that is a fifth of the width spent on five icons. Below `md` the rail
 * is gone entirely and this takes over, opened from the header's menu button —
 * same items, same brand, only summoned instead of resident.
 *
 * Shaped after ProfileDrawer (scrim at z-20, panel at z-30, translated rather
 * than mounted so it slides): the header is `sticky z-20`, so a scrim at the
 * same level but later in the tree dims it too, which is what a modal nav
 * wants — nothing behind it should look reachable.
 */
export interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The nav links. The caller wires each one to also close the drawer. */
  children: ReactNode;
}

export function NavDrawer({ open, onClose, children }: NavDrawerProps) {
  const { t } = useTranslation();

  /* Escape closes it: navigation is a detour, never a state to be trapped in. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    /* `md:hidden` on both halves: above the breakpoint the rail is back and
       this must not be openable, reachable by tab, or left hanging open by a
       resize. */
    <>
      {/* The scrim only exists while open, so it never eats clicks on the page. */}
      {open && (
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="fixed inset-0 z-20 cursor-default bg-gray-950/20 md:hidden dark:bg-gray-950/50"
        />
      )}

      {/*
        `inert` rather than `aria-hidden`: translated off-screen the panel is
        still displayed, so its links kept taking focus — tabbing from the menu
        button walked through five invisible destinations. `inert` takes them
        out of the tab order and the accessibility tree together, which is what
        `aria-hidden` alone only claimed to do.
      */}
      <aside
        inert={!open}
        className={`border-border bg-card fixed inset-y-0 left-0 z-30 flex w-60 max-w-[80%] flex-col border-r shadow-xl transition-transform duration-200 ease-out md:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* The rail's brand block, at the rail's height, so opening the drawer
            lands the logo exactly where the header would have drawn it. */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
          <div
            className="bg-primary flex size-7 shrink-0 items-center justify-center rounded-lg"
            style={superellipse}
          >
            <Workflow className="text-card size-4" strokeWidth={2} />
          </div>
          <strong className="text-sm font-semibold whitespace-nowrap">Workflow Studio</strong>
        </div>

        <nav className="flex flex-col gap-1.5 p-3 pt-1">{children}</nav>
      </aside>
    </>
  );
}
