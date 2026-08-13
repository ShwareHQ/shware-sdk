/** The CLI assembles discovery + the optional user config under this id (see src/server.ts). */
declare module 'virtual:workflow-config' {
  import type { ResolvedStudioConfig } from '../config';
  const config: ResolvedStudioConfig;
  export default config;
}
