import { hostname } from 'node:os';
import { defineStats } from '@shware/workflow-ui/config';

/** Server-side on purpose: `node:os` does not exist in a browser. */
export default defineStats({
  reports: () => [{ id: 'onboarding', entered: 3, completed: 1, converted: 1, active: 2 }],
  nodeStats: (workflow: string) => ({ [`${workflow}:0`]: hostname().length > 0 ? 2 : 0 }),
  segments: () => {
    throw new Error('segments are down');
  },
});
