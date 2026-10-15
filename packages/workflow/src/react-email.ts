import { type ComponentType, type ReactElement, createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import type { EmailRenderer } from './cloudflare';
import { type EmailTemplate, parseTemplateProps } from './templates';

/**
 * `@shware/workflow/react-email` — an EmailRenderer over the project's email
 * registry (`react-dom` is an optional peer dependency; import this subpath
 * only when you use it).
 *
 * The registry maps keys to `emailTemplate({...})` definitions. Props are
 * parsed against the template's schema before the component renders — a
 * failure throws TemplateValidationError and nothing renders — and the
 * component renders as an element, so hooks and context work. Rendering
 * streams and waits for every Suspense boundary (`allReady`) — react-email's
 * `<Tailwind>` suspends while it compiles the classes, which synchronous
 * static markup cannot wait for — then prepends the XHTML doctype react-email
 * uses. @react-email/render itself is avoided because its Workers build
 * statically imports prettier and html-to-text for options never used here.
 */

const DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

export function registryRenderer(emails: Record<string, EmailTemplate>): EmailRenderer {
  return async (key, props) => {
    if (!Object.hasOwn(emails, key)) throw new Error(`unknown email template: ${key}`);
    const template = emails[key];
    const parsed = parseTemplateProps(template, key, props);
    const element = createElement(template.component as ComponentType<object>, parsed);
    return { subject: template.subject, html: DOCTYPE + (await renderToHtml(element)) };
  };
}

/** Render to a string once every Suspense boundary has resolved; a rendering error rejects. */
async function renderToHtml(element: ReactElement): Promise<string> {
  let failure: unknown;
  const stream = await renderToReadableStream(element, {
    onError: (error) => {
      failure = error;
    },
  });
  await stream.allReady;
  const html = await new Response(stream).text();
  if (failure !== undefined) {
    throw failure instanceof Error ? failure : new Error('email render failed', { cause: failure });
  }
  // Streaming a document adds what static markup did not: an HTML5 doctype (the caller prepends
  // the XHTML one email clients expect) and React 19's image preload hints, which mean nothing in
  // an email. Both are dropped, as @react-email/render does.
  return html
    .replace(/^<!DOCTYPE html>/i, '')
    .replace(/<link rel="preload" as="image"[^>]*\/>/g, '');
}
