/** The CLI injects the user's config under this id (see src/server.ts). */
declare module 'virtual:workflow-config' {
  import type { WorkflowUIConfig } from '../config';
  const config: WorkflowUIConfig;
  export default config;
}
