import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Toaster } from 'sonner';

/** Toasts, styled to match the canvas: superellipse corners, Inter, slate palette. */
export function ToastProvider() {
  return (
    <Toaster
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
        style: { cornerShape: 'superellipse(1.2)' } as CSSProperties,
        classNames: {
          toast: clsx(
            'flex w-90 items-center gap-x-2 font-sans',
            'rounded-2xl bg-white py-4 pr-4 pl-3 ring-1 ring-slate-200',
            'shadow-[0_4px_12px_rgba(15,23,42,0.1)]'
          ),
          title: 'text-sm font-medium text-slate-900',
          description: 'mt-1 text-xs font-normal text-slate-500',
          closeButton: clsx(
            'order-last ml-auto size-5 p-0.5 text-slate-400 hover:text-slate-900',
            'transition-colors duration-200'
          ),
        },
      }}
    />
  );
}
