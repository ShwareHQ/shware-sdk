import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { superellipse } from '../corner-shape';

/**
 * Same API as the template project's Modal so the two stay diffable, but built
 * on floating-ui (which the studio already ships for the Dropdown) instead of
 * headlessui — one positioning library, not two.
 */
interface Props {
  visible?: boolean;
  children: ReactNode;
  className?: string;
  /** Blocks dismissal (Esc, outside press) while a save is in flight. */
  disabled?: boolean;
  onCancel?: () => void;
}

export function Modal({ visible = false, className, disabled = false, children, onCancel }: Props) {
  const { refs, context } = useFloating({
    open: visible,
    onOpenChange: (open) => {
      if (!open && !disabled) onCancel?.();
    },
  });

  const { getFloatingProps } = useInteractions([
    useDismiss(context, { enabled: !disabled }),
    useRole(context),
  ]);

  if (!visible) return null;

  return (
    <FloatingPortal>
      <FloatingOverlay
        lockScroll
        className="z-50 flex items-center justify-center bg-black/10 backdrop-blur-xs dark:bg-white/10"
      >
        <FloatingFocusManager context={context}>
          <div
            ref={refs.setFloating}
            style={superellipse}
            className={cn(
              'bg-card relative max-h-dvh max-w-dvw overflow-y-auto rounded-3xl',
              'shadow-lg dark:shadow-gray-700',
              className
            )}
            {...getFloatingProps()}
          >
            {children}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}

export function ModalTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-primary text-lg font-semibold">{children}</h2>;
}
