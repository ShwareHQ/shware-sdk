import { render } from '@react-email/render';
import { useQuery } from '@tanstack/react-query';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { type ReactElement, createElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { collectTemplateRefs } from '../../components/template-refs';
import { TemplatesPage } from '../../components/templates-page';
import type { EmailModule } from '../../config';
import { Route as rootRoute } from './__root';

function EmailsEmpty() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center text-sm text-gray-500">
      {t('emails.empty')}
    </div>
  );
}

/** `/emails` lands on the first key, so the nav item is never a dead end. */
export const emailsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/emails',
  beforeLoad: ({ context }) => {
    const refs = collectTemplateRefs(
      Object.values(context.config.workflows).map((builder) => builder.toIR())
    );
    const first = refs[0];
    if (first !== undefined) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({ to: '/emails/$key', params: { key: first.key } });
    }
  },
  component: EmailsEmpty,
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

function EmailView() {
  const { key } = emailRoute.useParams();
  const { config } = emailRoute.useRouteContext();
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
      onSelect={(next) => void navigate({ to: '/emails/$key', params: { key: next } })}
      preview={{
        ...(data?.html !== undefined ? { html: data.html } : {}),
        ...(data?.subject !== undefined ? { subject: data.subject } : {}),
        ...(error ? { error: error.message } : {}),
        loading: isPending && emails[key] !== undefined,
      }}
    />
  );
}

export const emailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/emails/$key',
  component: EmailView,
});
