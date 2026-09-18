import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

/**
 * Where you are, as a path: parents are links back up, the leaf is the current
 * view. The leaf may be any node — a detail page puts its switcher dropdown
 * there, so "which workflow" is both stated and changeable in one place.
 */
export interface Crumb {
  label: ReactNode;
  /** Route to link to; omit on the leaf (and on anything not navigable). */
  to?: string;
  params?: Record<string, string>;
}

export function Breadcrumb({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <Fragment key={index}>
            {index > 0 && (
              <ChevronRight className="text-muted size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            )}
            {item.to !== undefined && !last ? (
              <Link
                to={item.to as LinkProps['to']}
                params={item.params as LinkProps['params']}
                className="text-muted hover:text-primary shrink-0 truncate transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={last ? 'text-primary min-w-0 truncate' : 'text-muted shrink-0 truncate'}
              >
                {item.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
