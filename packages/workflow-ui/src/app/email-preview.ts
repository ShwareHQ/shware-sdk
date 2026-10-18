import { render } from '@react-email/render';
import type { EmailTemplate } from '@shware/workflow';
import { useQuery } from '@tanstack/react-query';
import { createElement } from 'react';
import {
  type Props,
  type TemplateFailure,
  entryIdentity,
  prepareEmail,
  renderFailure,
} from '../utils/template-content';

/** One preview render: the document, or the reason there is none — never both. */
export type EmailPreviewResult =
  | { status: 'ok'; html: string; subject: string | undefined }
  | { status: 'invalid'; failure: TemplateFailure };

/**
 * Render one registered template to HTML; the query keeps it off the render
 * path. Every surface that previews the same template with the same props —
 * the templates page, the canvas inspector — shares one render.
 *
 * The key carries the entry's identity and the props, so an HMR edit (a new
 * module object) or an in-memory prop change is a new render that validates
 * again, and a refusal is this render's result rather than an error sitting
 * beside the last success. A definition parses its props first (see
 * prepareEmail); a component that throws is a failure too.
 */
export function useEmailPreview(mod: EmailTemplate | undefined, key: string, props?: Props) {
  return useQuery({
    queryKey: ['email-preview', key, entryIdentity(mod), props ?? null],
    queryFn: async (): Promise<EmailPreviewResult> => {
      if (mod === undefined) throw new Error(`no email registered for '${key}'`);
      const prepared = prepareEmail(mod, props);
      if (!prepared.ok) return { status: 'invalid', failure: prepared.failure };
      const { component, props: parsed, subject } = prepared.email;
      try {
        return { status: 'ok', html: await render(createElement(component, parsed)), subject };
      } catch (error) {
        return { status: 'invalid', failure: renderFailure(error) };
      }
    },
    enabled: mod !== undefined,
    retry: false,
  });
}
