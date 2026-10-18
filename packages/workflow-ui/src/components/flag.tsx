import { type ComponentType, type SVGProps, useEffect, useState } from 'react';

/*
 * Country flags, lazy per code: 265 SVGs live in the glob, and eagerly
 * bundling a megabyte of vector flags for the one or two a drawer shows would
 * be absurd. Each flag module loads on first render of its code and is cached
 * by the module system from then on. vite-only (glob + svgr) — this component
 * is app-internal and deliberately not part of the library exports.
 */
type FlagComponent = ComponentType<SVGProps<SVGSVGElement>>;

const FLAGS: Partial<Record<string, () => Promise<FlagComponent>>> =
  import.meta.glob<FlagComponent>('../app/assets/flags/*.svg', {
    query: '?react',
    import: 'default',
  });

export interface FlagProps {
  /** ISO 3166-1 alpha-2, case-insensitive. Unknown codes render nothing. */
  code: string;
  className?: string;
}

export function Flag({ code, className }: FlagProps) {
  const key = `../app/assets/flags/${code.toUpperCase()}.svg`;
  const load = Object.hasOwn(FLAGS, key) ? FLAGS[key] : undefined;
  const [loaded, setLoaded] = useState<{
    load: typeof load;
    Component: ComponentType<SVGProps<SVGSVGElement>>;
  }>();

  useEffect(() => {
    if (load === undefined) return;
    let alive = true;
    void load().then((Component) => {
      if (alive) setLoaded({ load, Component });
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const Component = loaded !== undefined && loaded.load === load ? loaded.Component : undefined;
  if (Component === undefined) return null;
  return <Component className={className} aria-hidden />;
}
