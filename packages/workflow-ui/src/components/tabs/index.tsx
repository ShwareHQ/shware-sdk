import { Link, type LinkProps } from '@tanstack/react-router';
import { cn } from '../../utils/cn';
import { superellipse } from '../corner-shape';

/**
 * Segmented view switcher for detail-page headers: a pill group on the
 * `selected` surface with the active tab lifted onto a card. Router-aware —
 * items are Links, so active state follows the URL and deep links just work.
 */
export interface TabItem {
  to: string;
  label: string;
  /** Match the route exactly (for index tabs whose path prefixes the others). */
  exact?: boolean;
}

interface Props {
  items: readonly TabItem[];
  /** Route params shared by every tab link, e.g. `{ name }`. */
  params?: Record<string, string>;
  className?: string;
}

export function Tabs({ items, params, className }: Props) {
  return (
    <nav
      className={cn('bg-selected flex items-center gap-0.5 rounded-lg p-0.5', className)}
      style={superellipse}
    >
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to as LinkProps['to']}
          params={params as LinkProps['params']}
          activeOptions={{ exact: item.exact ?? false }}
          className="text-secondary hover:text-primary rounded-md px-3 py-1 text-sm font-medium transition-colors"
          activeProps={{ className: '!bg-card !text-primary shadow-sm' }}
          style={superellipse}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
