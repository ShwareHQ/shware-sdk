import { defineStats } from '@shware/workflow-ui/config';
import { demoStats } from './src/demo-stats';

/** The studio's numbers: a deterministic stand-in for a real stats API (see src/demo-stats.ts). */
export default defineStats(demoStats);
