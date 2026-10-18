import type { ScalarIR } from './ir';
import {
  type PushContent,
  type PushTemplate,
  indexTemplates,
  lookupTemplate,
  renderPushContent,
} from './templates';

/**
 * `@shware/workflow/push` — push-notification content. A push is data, not a
 * component: a title and a body the OS renders in its own chrome, built by a
 * `pushTemplate`'s `content(parsedProps)` — final text, never placeholder-
 * expanded, so braces in user data survive. Transport is a separate concern
 * (`@shware/workflow/apns`, `@shware/workflow/fcm`).
 */

export type RenderedPush = PushContent;

export type PushRenderer = (
  template: string,
  props: Record<string, ScalarIR | undefined>
) => Promise<RenderedPush>;

/** A renderer over the registry, by template id; a TemplateValidationError means nothing may be sent. */
export function registryPushRenderer(pushes: Readonly<Record<string, PushTemplate>>): PushRenderer {
  const index = indexTemplates('push', pushes);
  return async (id, props) => renderPushContent(lookupTemplate(index, 'push', id), props);
}
