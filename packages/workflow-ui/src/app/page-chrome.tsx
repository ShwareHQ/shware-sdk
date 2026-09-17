import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The unified header's three slots — breadcrumb, centre title, right-hand
 * actions — filled by whichever route is active.
 *
 * Routes portal into DOM slots the root owns rather than lifting state into
 * it. Lifted state looks simpler but loops: a route renders, sets the slot
 * value, the root re-renders, the route (a child of its Outlet) re-renders,
 * its `actions` node has a new identity, it sets again. Portals sidestep all
 * of that — React context, the router included, flows through them, and the
 * root never re-renders on a route's account.
 *
 * The slot elements land in state via callback refs, so the very first paint
 * has none and portals skip; the root's commit fills them one tick later.
 *
 * Every callback here is memoised, and that is load-bearing, not tidiness. A
 * callback ref with a new identity makes React call the old one with `null`
 * and the new one with the element on every commit; that null→element flip is
 * a real state change each time, so the header re-renders, mints another
 * callback, and the tree never settles ("maximum update depth exceeded").
 */
export interface ChromeSlots {
  breadcrumb: HTMLElement | null;
  title: HTMLElement | null;
  actions: HTMLElement | null;
}

interface ChromeContextValue {
  slots: ChromeSlots;
  register: (slot: keyof ChromeSlots, element: HTMLElement | null) => void;
}

const ChromeContext = createContext<ChromeContextValue | undefined>(undefined);

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<ChromeSlots>({ breadcrumb: null, title: null, actions: null });
  const register = useCallback(
    (slot: keyof ChromeSlots, element: HTMLElement | null) =>
      setSlots((current) =>
        current[slot] === element ? current : { ...current, [slot]: element }
      ),
    []
  );

  return <ChromeContext value={{ slots, register }}>{children}</ChromeContext>;
}

/** For the root: a callback ref that binds one slot element. */
export function useChromeSlotRef(slot: keyof ChromeSlots) {
  const context = useContext(ChromeContext);
  if (context === undefined)
    throw new Error('useChromeSlotRef must be used inside PageChromeProvider');
  const { register } = context;
  return useCallback((element: HTMLElement | null) => register(slot, element), [register, slot]);
}

export interface PageChromeProps {
  breadcrumb?: ReactNode;
  /** Optional; most views identify themselves by the breadcrumb leaf and leave this empty. */
  title?: ReactNode;
  actions?: ReactNode;
}

/** Rendered by a route; declares what the header shows while that route is mounted. */
export function PageChrome({ breadcrumb, title, actions }: PageChromeProps) {
  const context = useContext(ChromeContext);
  if (context === undefined) throw new Error('PageChrome must be used inside PageChromeProvider');
  const { slots } = context;

  return (
    <>
      {breadcrumb !== undefined && slots.breadcrumb && createPortal(breadcrumb, slots.breadcrumb)}
      {title !== undefined && slots.title && createPortal(title, slots.title)}
      {actions !== undefined && slots.actions && createPortal(actions, slots.actions)}
    </>
  );
}
