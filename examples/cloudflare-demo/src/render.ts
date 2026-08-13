import { render } from '@react-email/render';
import type { EmailRenderer } from '../../../packages/workflow/src/cloudflare/senders';
import { emails } from '../emails';

/**
 * App-side renderer: registry lookup, then react-email rendering.
 * The engine only ever passes a key plus resolved scalar props — components
 * never enter the engine's world.
 */
export const renderEmail: EmailRenderer = async (key, props) => {
  if (!Object.hasOwn(emails, key)) throw new Error(`unknown email template: ${key}`);
  const mod = emails[key as keyof typeof emails];

  const html = await render(mod.default(props as never) as never);
  // Subjects are string templates; the sender fills {prop} placeholders from the profile
  return { subject: mod.subject, html };
};
