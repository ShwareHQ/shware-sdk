import { render } from '@react-email/render';
import { useQuery } from '@tanstack/react-query';
import { type ReactElement, createElement } from 'react';
import type { EmailModule } from '../config';

/**
 * Render one registered template to HTML; the query keeps it off the render
 * path. Keyed by template only, so every surface that previews the same
 * template — the templates page, the canvas inspector — shares one render.
 */
export function useEmailPreview(mod: EmailModule | undefined, key: string) {
  return useQuery({
    queryKey: ['email-preview', key],
    queryFn: async () => {
      if (mod === undefined) return { html: undefined, subject: undefined };
      // The module contract narrows props with never (contravariance); restore a concrete shape here
      const props = (mod.preview ?? {}) as Record<string, unknown>;
      const Component = mod.default as (p: Record<string, unknown>) => ReactElement;
      return {
        html: await render(createElement(Component, props)),
        // Subjects are string templates, shown verbatim ({prop} placeholders included)
        subject: mod.subject,
      };
    },
    enabled: mod !== undefined,
  });
}
