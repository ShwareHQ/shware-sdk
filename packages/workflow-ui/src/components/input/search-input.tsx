import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../../utils/cn';
import { Input, type Size } from './index';

interface Props extends Omit<ComponentProps<'input'>, 'size' | 'type'> {
  size?: Size;
  className?: string;
}

/** The list pages' search field: an `Input` with the studio's standard 16px glass. */
export function SearchInput({ size = 'sm', className, ...props }: Props) {
  return (
    <div className={cn('relative', className)}>
      <Search
        size={16}
        strokeWidth={2}
        aria-hidden
        className="text-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
      />
      <Input {...props} size={size} type="search" className="w-full pl-8" />
    </div>
  );
}
