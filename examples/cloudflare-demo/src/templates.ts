import { templates } from '@shware/workflow';
import { email } from './email';

/** Registered once: the config takes the registry, the workflows take `t.email.<key>`. */
export const registry = { email };
export const t = templates(registry);
