import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Toaster } from 'sonner';
import { useTheme } from '../theme/root-provider';

/** Toasts, styled to match the canvas: superellipse corners, Inter, the gray ramp. */
export function ToastProvider() {
  const { resolved } = useTheme();

  return (
    <Toaster
      theme={resolved}
      position="top-center"
      icons={{
        success: <CircleCheck className="size-5 text-emerald-500" strokeWidth={2} />,
        info: <Info className="size-5 text-blue-500" strokeWidth={2} />,
        warning: <TriangleAlert className="size-5 text-amber-500" strokeWidth={2} />,
        error: <CircleAlert className="size-5 text-red-500" strokeWidth={2} />,
        close: <X className="size-4" strokeWidth={2} />,
      }}
      closeButton
      style={{ '--gap': '12px', '--width': '360px' } as CSSProperties}
      toastOptions={{
        unstyled: true,
        closeButton: false,
        // Long enough to read after a write-back reload lands the page back
        duration: 5000,
        style: { cornerShape: 'superellipse(1.2)' } as CSSProperties,
        classNames: {
          toast: clsx(
            'flex w-90 items-center gap-x-2 font-sans',
            'bg-card ring-border rounded-2xl py-4 pr-4 pl-3 ring-1',
            'shadow-[0_4px_12px_var(--color-card-shadow)]'
          ),
          title: 'text-sm font-medium text-primary',
          description: 'mt-1 text-xs font-normal text-muted',
          closeButton: clsx(
            'text-muted hover:text-primary order-last ml-auto size-5 p-0.5',
            'transition-colors duration-200'
          ),
        },
      }}
    />
  );
}
