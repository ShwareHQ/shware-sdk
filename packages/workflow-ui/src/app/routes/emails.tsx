import { createRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Breadcrumb } from '../../components/breadcrumb';
import { EmailList, type EmailListItem } from '../../components/email-list';
import { SearchInput } from '../../components/input/search-input';
import { collectTemplates } from '../../components/template-refs';
import { TemplatesPage } from '../../components/templates-page';
import { displayName } from '../../utils/label';
import { type Props, lookupTemplate } from '../../utils/template-content';
import { useEmailPreview } from '../email-preview';
import { useTheme } from '../integrations/theme/root-provider';
import { PageChrome } from '../page-chrome';
import { Route as rootRoute } from './__root';

/* ---------------------------------- List ---------------------------------- */

function EmailsIndex() {
  const { config } = emailsIndexRoute.useRouteContext();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const refs = collectTemplates(Object.values(config.workflows), config);
    return refs.map((ref) => {
      // Each channel reads its own registry — a push key is registered in `pushes`,
      // a chat key in the registry named after its client
      const found = lookupTemplate(config, ref.channel, ref.key);
      const labels = { name: found?.entry.title, description: found?.entry.description };
      const item: EmailListItem = {
        key: ref.key,
        channel: ref.channel,
        registered: found !== undefined,
      };
      if (labels.name !== undefined) item.name = labels.name;
      if (labels.description !== undefined) item.description = labels.description;
      return item;
    });
  }, [config]);

  /* Substring match over everything a template is known by: key, name, description. */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return items;
    return items.filter((item) =>
      [item.key, item.name ?? '', item.description ?? ''].some((text) =>
        text.toLowerCase().includes(needle)
      )
    );
  }, [items, query]);

  if (items.length === 0) {
    return (
      <div className="text-muted flex flex-1 items-center justify-center text-sm">
        {t('emails.empty')}
      </div>
    );
  }

  return (
    /* Nothing here scrolls: the shell's content column is the one scrollport. */
    <div className="flex-1">
      <PageChrome breadcrumb={<Breadcrumb items={[{ label: t('nav.templates') }]} />} />
      {/*
        The search field belongs with what it filters, not up in the chrome.
        It scrolls away with the list: the app header is the only sticky
        chrome, so nothing here needs an opaque fill or a stacking context.
      */}
      <div className="px-6 pt-4 pb-3">
        <SearchInput
          className="w-72"
          placeholder={t('emails.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="px-6 pb-6">
        {filtered.length === 0 ? (
          <div className="text-muted flex items-center justify-center py-24 text-sm">
            {t('emails.noMatches', { query: query.trim() })}
          </div>
        ) : (
          <EmailList
            items={filtered}
            onOpen={(key, channel) =>
              void navigate({ to: '/templates/$key', params: { key }, search: { channel } })
            }
          />
        )}
      </div>
    </div>
  );
}

export const emailsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates',
  component: EmailsIndex,
});

function EmailView() {
  const { key } = emailRoute.useParams();
  const { channel } = emailRoute.useSearch();
  const { config } = emailRoute.useRouteContext();
  const { t } = useTranslation();
  const { resolved: studioScheme } = useTheme();

  const refs = useMemo(() => collectTemplates(Object.values(config.workflows), config), [config]);
  /*
   * The key plus the channel the link carried: one key may be registered as
   * an email and as a push, and those are two templates. Without a channel the
   * first reference wins, as before.
   */
  const ref =
    refs.find(
      (candidate) => candidate.key === key && (channel ?? candidate.channel) === candidate.channel
    ) ?? refs.find((candidate) => candidate.key === key);
  const activeChannel = ref?.channel ?? channel ?? 'email';

  /*
   * In-memory props for the preview, tied to the template they were typed
   * for: switching template drops them, an HMR edit keeps them and validates
   * them again against the new schema.
   */
  const [override, setOverride] = useState<{ id: string; props: Props } | undefined>();
  const id = `${activeChannel}:${key}`;
  const previewProps = override?.id === id ? override.props : undefined;

  /* Only email renders a document; every other channel's content is data. */
  const found = lookupTemplate(config, activeChannel, key);
  const selected = found?.channel === 'email' ? found.entry : undefined;
  const { data, error, isPending } = useEmailPreview(selected, key, config.email, previewProps);

  return (
    <div className="flex flex-1 flex-col">
      {/* The header is the root's: breadcrumb with the template switcher as its leaf. */}
      <PageChrome
        breadcrumb={
          <Breadcrumb
            items={[
              { label: t('nav.templates'), to: '/templates' },
              {
                /* The display name of exactly this template: its channel's registry, not the first key match. */
                label: displayName(found?.entry.title, key),
                to: '/templates/$key',
                params: { key },
                search: { channel: activeChannel },
              },
              /*
                The leaf is the page name, still "Preview" now that the
                single-item tab strip is gone: the workflow detail page keeps
                real tabs and ends its breadcrumb on one, so dropping it here
                would leave the three detail pages shaped differently.
              */
              { label: t('emails.tabs.preview') },
            ]}
          />
        }
      />
      <div className="flex flex-1 flex-col">
        <TemplatesPage
          refs={refs}
          emails={config.emails}
          pushes={config.pushes}
          discords={config.discords}
          slacks={config.slacks}
          {...(config.title !== undefined ? { appName: config.title } : {})}
          defaultScheme={studioScheme}
          selected={key}
          selectedChannel={activeChannel}
          emailConfig={config.email}
          previewProps={previewProps}
          onPreviewPropsChange={(props) =>
            setOverride(props === undefined ? undefined : { id, props })
          }
          preview={{
            ...(data?.status === 'ok' ? { html: data.html } : {}),
            ...(data?.status === 'ok' && data.subject !== undefined
              ? { subject: data.subject }
              : {}),
            ...(data?.status === 'invalid' ? { failure: data.failure } : {}),
            ...(error ? { error: error.message } : {}),
            loading: isPending && selected !== undefined,
          }}
        />
      </div>
    </div>
  );
}

export const emailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates/$key',
  /* `?channel=push` picks the push when one key is registered in several registries. */
  validateSearch: (search: Record<string, unknown>): { channel?: string } =>
    typeof search.channel === 'string' ? { channel: search.channel } : {},
  component: EmailView,
});
