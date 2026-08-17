import {
  FloatingFocusManager,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from '@floating-ui/react';
import { Ellipsis } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '../../utils/cn';
import { superellipse } from '../corner-shape';

/**
 * Row-level overflow menu: a three-dot trigger opening a floating action list.
 * Clicks never reach the row underneath — the trigger stops propagation and
 * the panel renders in place above everything — so a menu inside a clickable
 * table row stays safe.
 */
export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** Destructive actions render in the danger colour. */
  danger?: boolean;
}

interface Props {
  items: MenuItem[];
  'aria-label'?: string;
  className?: string;
}

export function Menu({ items, className, ...aria }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const listRef = useRef<(HTMLElement | null)[]>([]);
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'menu' }),
    useListNavigation(context, { listRef, activeIndex, onNavigate: setActiveIndex }),
  ]);

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        className={cn(
          'text-muted hover:bg-hover hover:text-primary flex size-8 items-center justify-center',
          'rounded-lg transition-colors focus:outline-none',
          className
        )}
        style={superellipse}
        {...aria}
        {...getReferenceProps({
          onClick(e) {
            e.stopPropagation();
          },
        })}
      >
        <Ellipsis size={16} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="border-border bg-card z-50 min-w-36 rounded-xl border p-1 shadow-lg"
            {...getFloatingProps()}
          >
            {items.map((item, index) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                ref={(node) => {
                  listRef.current[index] = node;
                }}
                tabIndex={activeIndex === index ? 0 : -1}
                className={cn(
                  'flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm',
                  item.danger === true ? 'text-red-500' : 'text-primary',
                  activeIndex === index && 'bg-selected'
                )}
                style={superellipse}
                {...getItemProps({
                  onClick(e) {
                    e.stopPropagation();
                    setOpen(false);
                    item.onSelect();
                  },
                })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}
