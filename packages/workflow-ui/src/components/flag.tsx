import { type ComponentType, type SVGProps, useEffect, useState } from 'react';

/*
 * Country flags, lazy per code: 265 SVGs live in the glob, and eagerly
 * bundling a megabyte of vector flags for the one or two a drawer shows would
 * be absurd. Each flag module loads on first render of its code and is cached
 * by the module system from then on. vite-only (glob + svgr) — this component
 * is app-internal and deliberately not part of the library exports.
 */
const FLAGS = import.meta.glob<ComponentType<SVGProps<SVGSVGElement>>>(
  '../app/assets/flags/*.svg',
  { query: '?react', import: 'default' }
);

export interface FlagProps {
  /** ISO 3166-1 alpha-2, case-insensitive. Unknown codes render nothing. */
  code: string;
  className?: string;
}

export function Flag({ code, className }: FlagProps) {
  const [Component, setComponent] = useState<ComponentType<SVGProps<SVGSVGElement>> | undefined>(
    undefined
  );
  const load = FLAGS[`../app/assets/flags/${code.toUpperCase()}.svg`];

  useEffect(() => {
    let alive = true;
    setComponent(undefined);
    void load?.().then((mod) => {
      if (alive) setComponent(() => mod);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  if (Component === undefined) return null;
  return <Component className={className} aria-hidden />;
}
