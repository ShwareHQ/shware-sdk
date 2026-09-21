import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EmailRenderer } from './cloudflare/senders';

/**
 * `@shware/workflow/react-email` — an EmailRenderer over the project's email
 * registry (`react-dom` is an optional peer dependency; import this subpath
 * only when you use it).
 *
 * The registry is the same object that types `templates<Emails>()`: key →
 * module with a default-exported component and a `subject` string template.
 * Rendering is react-dom's static markup with the XHTML doctype react-email
 * prepends; @react-email/render itself is avoided because its Workers build
 * statically imports prettier and html-to-text for options never used here.
 */

export interface EmailRegistryModule {
  default: (props: never) => ReactElement;
  subject?: string;
}

const DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

export function registryRenderer(emails: Record<string, EmailRegistryModule>): EmailRenderer {
  return async (key, props) => {
    if (!Object.hasOwn(emails, key)) throw new Error(`unknown email template: ${key}`);
    const mod = emails[key];
    const element = mod.default(props as never);
    return { subject: mod.subject ?? key, html: DOCTYPE + renderToStaticMarkup(element) };
  };
}
