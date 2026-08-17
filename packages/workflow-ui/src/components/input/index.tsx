import type { ComponentProps } from 'react';
import { cn } from '../../utils/cn';

/**
 * Ported from the design system in the template project — same API, so the two
 * stay diffable. Colours resolve through the studio's CSS variables
 * (`--color-textfield`, `--color-placeholder`, `--color-accent`).
 */
export type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface Props extends Omit<ComponentProps<'input'>, 'size'> {
  size?: Size;
  htmlSize?: number;
  className?: string;
}

const SIZE_STYLE: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs rounded-md focus-visible:ring-2',
  sm: 'h-9 px-2 text-sm rounded-lg focus-visible:ring-3',
  md: 'h-10 px-3 text-sm rounded-xl focus-visible:ring-3',
  lg: 'h-12 px-4 text-md rounded-xl focus-visible:ring-4',
  xl: 'h-14 px-4 text-lg rounded-2xl focus-visible:ring-4',
};

export function Input({ size = 'md', type = 'text', htmlSize, className, ...props }: Props) {
  return (
    <input
      {...props}
      type={type}
      size={htmlSize}
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
