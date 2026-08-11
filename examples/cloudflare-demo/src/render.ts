import { render } from '@react-email/render';
import type { EmailRenderer } from '../../../packages/workflow/src/cloudflare/senders';
import { emails } from '../emails';

/**
 * App-side renderer: registry lookup, then react-email rendering.
 * The engine only ever passes a key plus resolved scalar props — components
 * never enter the engine's world.
 */
export const renderEmail: EmailRenderer = async (key, props) => {
  const mod = emails[key as keyof typeof emails];
  if (!mod) throw new Error(`unknown email template: ${key}`);

  const html = await render(mod.default(props as never) as never);
  const subject =
    typeof mod.subject === 'function'
      ? (mod.subject as (p: unknown) => string)(props)
      : String(mod.subject ?? key);

  return { subject, html };
};
