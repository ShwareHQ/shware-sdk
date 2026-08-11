import { clsx } from 'clsx';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { superellipse } from '../corner-shape';

/**
 * Ported from the design system in the template project — same API, so the two
 * stay diffable. Colours resolve through the studio's CSS variables
 * (`--color-primary`, `--color-accent`, `--color-gray-*`), so a project that
 * re-themes the ramp re-themes the buttons with it.
 */
export type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface Props extends Omit<ComponentProps<'button'>, 'type'> {
  size?: Size;
  children?: ReactNode;
  type?: 'submit' | 'reset' | 'button';
  variant?: 'text' | 'accent' | 'default' | 'secondary' | 'destructive' | 'outline';
}

const SIZE_STYLE: Record<Size, string> = {
  xs: 'h-7 px-3 text-xs rounded-md focus-visible:ring-2',
  sm: 'h-9 px-3 text-sm rounded-lg focus-visible:ring-3',
  md: 'h-10 px-4 text-sm rounded-xl focus-visible:ring-3',
  lg: 'h-12 px-6 text-base rounded-xl focus-visible:ring-4',
  xl: 'h-14 px-8 text-lg rounded-2xl focus-visible:ring-4',
};

const VARIANT_STYLE = {
  text: clsx(
    'text-primary border-none bg-transparent',
    'hover:bg-gray-100 focus-visible:ring-black/10 active:bg-gray-200/80',
    'dark:hover:bg-gray-800 dark:focus-visible:ring-white/20 dark:active:bg-gray-700/80'
  ),
  accent: clsx(
    'bg-accent active:bg-accent/80 text-white',
    'focus-visible:ring-accent/40 dark:focus-visible:ring-accent/50'
  ),
  default: clsx(
    'border-none bg-black text-white focus-visible:ring-black/20 dark:bg-white dark:text-black',
    'active:bg-black/80 dark:focus-visible:ring-white/30 dark:active:bg-white/80'
  ),
  secondary: clsx(
    'text-primary bg-gray-100 focus-visible:ring-black/10 active:bg-gray-200/80',
    'dark:bg-gray-800 dark:focus-visible:ring-white/20 dark:active:bg-gray-700/80'
  ),
  destructive: clsx(
    'text-white focus-visible:ring-red-400/40',
    'bg-red-400 active:bg-red-500/90',
    'dark:bg-red-400/70 dark:active:bg-red-400/90'
  ),
  outline: clsx(
    'text-primary border',
    'bg-white focus-visible:ring-black/10 active:bg-gray-100/70',
    'dark:bg-gray-900/70 dark:focus-visible:ring-white/30 dark:active:bg-gray-900'
  ),
};

export function Button({
  children,
  className,
  size = 'md',
  style,
  type = 'button',
  variant = 'default',
  ...props
}: Props) {
  return (
    <button
      // oxlint-disable-next-line react/button-has-type
      type={type}
      style={{ ...superellipse, ...style }}
      className={cn(
        SIZE_STYLE[size],
        VARIANT_STYLE[variant],
        'inline-flex items-center justify-center',
        'text-center font-medium transition-all duration-100 focus:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
