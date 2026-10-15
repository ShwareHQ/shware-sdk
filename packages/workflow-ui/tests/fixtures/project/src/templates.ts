import { templates } from '@shware/workflow';
import { email } from './email';

/** Registered once: the config takes `registry`, the flows take `t.email.<key>`. */
export const registry = { email };
export const t = templates(registry);
