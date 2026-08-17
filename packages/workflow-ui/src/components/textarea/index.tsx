import type { ComponentProps } from 'react';
import { cn } from '../../utils/cn';

/**
 * Ported from the design system in the template project — same API, so the two
 * stay diffable. Colours resolve through the studio's CSS variables
 * (`--color-textfield`, `--color-placeholder`, `--color-accent`).
 */
export type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface Props extends Omit<ComponentProps<'textarea'>, 'size'> {
  size?: Size;
  className?: string;
}

const SIZE_STYLE: Record<Size, string> = {
  xs: 'px-2 py-[5px] text-xs rounded-md focus-visible:ring-2',
  sm: 'px-2 py-[7px] text-sm rounded-lg focus-visible:ring-3',
  md: 'px-3 py-[9px] text-sm rounded-xl focus-visible:ring-3',
  lg: 'px-4 py-[11px] text-md rounded-xl focus-visible:ring-4',
  xl: 'px-4 py-[13px] text-lg rounded-2xl focus-visible:ring-4',
};

export function Textarea({ size = 'md', className, ...props }: Props) {
  return (
    <textarea
      {...props}
      className={cn(
        'transition-colors duration-100 focus:outline-none',
        'placeholder-placeholder bg-textfield focus-visible:border-accent border',
        'dark:focus-visible:ring-accent/50 focus-visible:ring-accent/40',
        SIZE_STYLE[size],
        className
      )}
    />
  );
}
