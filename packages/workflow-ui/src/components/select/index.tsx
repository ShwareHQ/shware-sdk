import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../../utils/cn';

/**
 * Native select on the same size ramp and field colours as `Input`, adapted
 * from the template project's design system (its floating-label variant is
 * marketing-page specific; the studio wants a plain field).
 */
export type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface Props extends Omit<ComponentProps<'select'>, 'size' | 'onChange'> {
  size?: Size;
  className?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  options?: { value: string; label: string }[];
}

const SIZE_STYLE: Record<Size, string> = {
  xs: 'h-7 pl-2 pr-7 text-xs rounded-md focus-visible:ring-2',
  sm: 'h-9 pl-2 pr-8 text-sm rounded-lg focus-visible:ring-3',
  md: 'h-10 pl-3 pr-8 text-sm rounded-xl focus-visible:ring-3',
  lg: 'h-12 pl-4 pr-9 text-md rounded-xl focus-visible:ring-4',
  xl: 'h-14 pl-4 pr-9 text-lg rounded-2xl focus-visible:ring-4',
};

export function Select({
  size = 'md',
  value,
  options,
  className,
  placeholder,
  onChange,
  ...props
}: Props) {
  return (
    <div className={cn('relative', className)}>
      <select
        {...props}
        value={value}
        className={cn(
          'w-full cursor-pointer appearance-none truncate transition-colors duration-100',
          'bg-textfield focus-visible:border-accent border focus:outline-none',
          'dark:focus-visible:ring-accent/50 focus-visible:ring-accent/40',
          value === '' || value === undefined ? 'text-placeholder' : 'text-primary',
          SIZE_STYLE[size]
        )}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {placeholder !== undefined && (
          <option value="" hidden>
            {placeholder}
          </option>
        )}
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        strokeWidth={2}
        aria-hidden
        className="text-secondary pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2"
      />
    </div>
  );
}
