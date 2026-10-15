import { templates } from '@shware/workflow';
import { email } from './email';
import { push } from './push';

/**
 * Templates are registered once, per channel: the config takes the registries
 * (`templates: registry`), the workflows take the references derived from them
 * (`t.email.<key>` / `t.push.<key>`). The registries type the keys — an
 * unregistered or cross-channel key does not compile — and each template's
 * `props` schema types every `.email(ref, props)` / `.push(ref, props)` site.
 */
export const registry = { email, push };
export const t = templates(registry);
