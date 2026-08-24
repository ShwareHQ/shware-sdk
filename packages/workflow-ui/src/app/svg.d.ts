/** vite-plugin-svgr: `?react` imports resolve to a React component. */
declare module '*.svg?react' {
  import type { FC, SVGProps } from 'react';
  const Component: FC<SVGProps<SVGSVGElement>>;
  export default Component;
}

/** Plain asset imports resolve to their served URL. */
declare module '*.png' {
  const url: string;
  export default url;
}

declare module '*.webp' {
  const url: string;
  export default url;
}
