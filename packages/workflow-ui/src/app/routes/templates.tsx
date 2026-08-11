import { render } from '@react-email/render';
import { useQuery } from '@tanstack/react-query';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { type ReactElement, createElement, useMemo } from 'react';
import { collectTemplateRefs } from '../../components/template-refs';
import { TemplatesPage } from '../../components/templates-page';
import type { EmailModule } from '../../config';
import { Route as rootRoute } from './__root';

/** `/templates` lands on the first key, so the tab is never a dead end. */
export const templatesIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates',
  beforeLoad: ({ context }) => {
    const refs = collectTemplateRefs(
      Object.values(context.config.workflows).map((builder) => builder.toIR())
    );
    const first = refs[0];
    if (first !== undefined) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({ to: '/templates/$key', params: { key: first.key } });
    }
  },
  component: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">
      No templates referenced by these workflows.
    </div>
  ),
});

/** Render one registered template to HTML; the query keeps it off the render path. */
function useEmailPreview(mod: EmailModule | undefined, key: string) {
  return useQuery({
    queryKey: ['email-preview', key],
    queryFn: async () => {
      if (mod === undefined) return { html: undefined, subject: undefined };
      // The module contract narrows props with never (contravariance); restore a concrete shape here
      const props = (mod.preview ?? {}) as Record<string, unknown>;
      const Component = mod.default as (p: Record<string, unknown>) => ReactElement;
      const buildSubject = mod.subject as ((p: Record<string, unknown>) => string) | undefined;
      return {
        html: await render(createElement(Component, props)),
        subject: buildSubject?.(props),
      };
    },
    enabled: mod !== undefined,
  });
}

function TemplateView() {
  const { key } = templateRoute.useParams();
  const { config } = templateRoute.useRouteContext();
  const navigate = useNavigate();

  const refs = useMemo(
    () => collectTemplateRefs(Object.values(config.workflows).map((builder) => builder.toIR())),
    [config]
  );
  const emails = config.emails ?? {};
  const { data, error, isPending } = useEmailPreview(emails[key], key);

  return (
    <TemplatesPage
      refs={refs}
      emails={emails}
      selected={key}
      onSelect={(next) => void navigate({ to: '/templates/$key', params: { key: next } })}
      preview={{
        ...(data?.html !== undefined ? { html: data.html } : {}),
        ...(data?.subject !== undefined ? { subject: data.subject } : {}),
        ...(error ? { error: error.message } : {}),
        loading: isPending && emails[key] !== undefined,
      }}
    />
  );
}

export const templateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates/$key',
  component: TemplateView,
});
