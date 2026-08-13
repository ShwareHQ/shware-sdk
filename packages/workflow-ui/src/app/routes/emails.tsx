import { render } from '@react-email/render';
import { useQuery } from '@tanstack/react-query';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { type ReactElement, createElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { collectTemplateRefs } from '../../components/template-refs';
import { TemplatesPage } from '../../components/templates-page';
import type { EmailModule } from '../../config';
import { lookup } from '../../utils/lookup';
import { reportSave, studioPost } from '../studio';
import { Route as rootRoute } from './__root';

function EmailsEmpty() {
  const { t } = useTranslation();
  return (
    <div className="text-muted flex h-full items-center justify-center text-sm">
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
    const first = refs.at(0);
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
      return {
        html: await render(createElement(Component, props)),
        // Subjects are string templates, shown verbatim ({prop} placeholders included)
        subject: mod.subject,
      };
    },
    enabled: mod !== undefined,
  });
}

function EmailView() {
  const { key } = emailRoute.useParams();
  const { config } = emailRoute.useRouteContext();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const refs = useMemo(
    () => collectTemplateRefs(Object.values(config.workflows).map((builder) => builder.toIR())),
    [config]
  );
  const emails = config.emails;
  const selected = lookup(emails, key);
  const { data, error, isPending } = useEmailPreview(selected, key);

  const report = (promise: Promise<void>): Promise<void> =>
    reportSave(promise, { saved: t('emails.saved'), failed: t('emails.saveFailed') });

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
        loading: isPending && selected !== undefined,
      }}
      addresses={config.addresses}
      onSaveEnvelope={(templateKey, field, value) =>
        report(studioPost('/__studio/envelope', { key: templateKey, field, value }))
      }
      onManageAddresses={() => void navigate({ to: '/settings' })}
    />
  );
}

export const emailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/emails/$key',
  component: EmailView,
});
