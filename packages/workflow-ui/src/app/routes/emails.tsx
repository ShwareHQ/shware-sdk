import { createRoute, useNavigate } from '@tanstack/react-router';
import { Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Breadcrumb } from '../../components/breadcrumb';
import { Button } from '../../components/button';
import { EmailList, type EmailListItem } from '../../components/email-list';
import { Input } from '../../components/input';
import { SearchInput } from '../../components/input/search-input';
import { Modal, ModalTitle } from '../../components/modal';
import { collectTemplateRefs } from '../../components/template-refs';
import { TemplatesPage } from '../../components/templates-page';
import { Textarea } from '../../components/textarea';
import type { ResolvedStudioConfig } from '../../config';
import { displayName } from '../../utils/label';
import { lookup } from '../../utils/lookup';
import { useEmailPreview } from '../email-preview';
import { useTheme } from '../integrations/theme/root-provider';
import { PageChrome } from '../page-chrome';
import { reportSave, studioPost } from '../studio';
import { Route as rootRoute } from './__root';

/* ---------------------------------- List ---------------------------------- */

/**
 * One template's content module, whichever registry holds it. Only the labels
 * (`name` / `description`) are read through here, and every module type
 * carries those — which is why one lookup can serve all four channels.
 */
function lookupContent(
  config: ResolvedStudioConfig,
  channel: string,
  key: string
): { name?: string; description?: string } | undefined {
  switch (channel) {
    case 'push':
      return lookup(config.pushes, key);
    case 'slack':
      return lookup(config.slack, key);
    case 'discord':
      return lookup(config.discord, key);
    default:
      return lookup(config.emails, key);
  }
}

/** Draft for the edit dialog; `original` decides which fields actually changed on save. */
interface EditDraft {
  key: string;
  /** Labels are patched into the module file, so an unregistered key has nowhere to save. */
  registered: boolean;
  name: string;
  description: string;
  original: { name: string; description: string };
}

function EmailsIndex() {
  const { config } = emailsIndexRoute.useRouteContext();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<EditDraft | undefined>(undefined);

  const items = useMemo(() => {
    const refs = collectTemplateRefs(
      Object.values(config.workflows).map((builder) => builder.toIR())
    );
    return refs.map((ref) => {
      // Each channel reads its own registry — a push key is registered in `pushes`,
      // a chat key in the registry named after its client
      const mod = lookupContent(config, ref.channel, ref.key);
      const item: EmailListItem = {
        key: ref.key,
        channel: ref.channel,
        registered: mod !== undefined,
      };
      if (mod?.name !== undefined) item.name = mod.name;
      if (mod?.description !== undefined) item.description = mod.description;
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

  const openEdit = (key: string) => {
    const found = items.find((item) => item.key === key);
    if (found === undefined) return;
    const original = { name: found.name ?? '', description: found.description ?? '' };
    setEditing({ key, registered: found.registered, ...original, original });
  };

  /* Only the fields that changed are written back, one envelope call each. */
  const saveEdit = () => {
    if (editing === undefined || !editing.registered) return;
    const { key, name, description, original } = editing;
    const run = async () => {
      if (name !== original.name) {
        await studioPost('/__studio/envelope', { key, field: 'name', value: name });
      }
      if (description !== original.description) {
        await studioPost('/__studio/envelope', { key, field: 'description', value: description });
      }
    };
    void reportSave(run(), { saved: t('emails.saved'), failed: t('emails.saveFailed') });
    setEditing(undefined);
  };

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
            onOpen={(key) => void navigate({ to: '/templates/$key', params: { key } })}
            onEdit={openEdit}
          />
        )}
      </div>

      <Modal
        visible={editing !== undefined}
        onCancel={() => setEditing(undefined)}
        className="w-100 p-6"
      >
        <ModalTitle>{t('emails.editTitle')}</ModalTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveEdit();
          }}
        >
          <label className="mt-5 block">
            <span className="text-secondary mb-1.5 block text-sm">{t('common.name')}</span>
            <Input
              className="w-full"
              value={editing?.name ?? ''}
              onChange={(e) => setEditing((draft) => draft && { ...draft, name: e.target.value })}
            />
          </label>
          <label className="mt-4 block">
            <span className="text-secondary mb-1.5 block text-sm">{t('common.description')}</span>
            <Textarea
              rows={3}
              className="w-full"
              value={editing?.description ?? ''}
              onChange={(e) =>
                setEditing((draft) => draft && { ...draft, description: e.target.value })
              }
            />
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" type="submit" disabled={editing !== undefined && !editing.registered}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>
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
  const { config } = emailRoute.useRouteContext();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { resolved: studioScheme } = useTheme();
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [sending, setSending] = useState(false);

  const refs = useMemo(
    () => collectTemplateRefs(Object.values(config.workflows).map((builder) => builder.toIR())),
    [config]
  );
  const emails = config.emails;
  const pushes = config.pushes;
  /* Only email renders a document; every other channel's content is data. */
  const isEmail = (refs.find((ref) => ref.key === key)?.channel ?? 'email') === 'email';
  const selected = isEmail ? lookup(emails, key) : undefined;
  const { data, error, isPending } = useEmailPreview(selected, key);

  /* Switcher options: every referenced template, labelled by its module name. */
  const options = useMemo(
    () =>
      refs.map((ref) => ({
        value: ref.key,
        label: displayName(lookupContent(config, ref.channel, ref.key)?.name, ref.key),
      })),
    [refs, config]
  );

  const report = (promise: Promise<void>): Promise<void> =>
    reportSave(promise, { saved: t('emails.saved'), failed: t('emails.saveFailed') });

  /* Test sends need the hook and a rendered preview; without both the button stays off. */
  const canTest = config.sendTest !== undefined && data?.html !== undefined;
  const sendTest = async () => {
    const to = testTo.trim();
    if (config.sendTest === undefined || data?.html === undefined || to === '') return;
    setSending(true);
    try {
      await config.sendTest({
        key,
        to,
        ...(data.subject !== undefined ? { subject: data.subject } : {}),
        html: data.html,
      });
      toast.success(t('emails.testSent', { to }));
      setTestOpen(false);
    } catch (cause) {
      toast.error(
        `${t('emails.testFailed')}: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      {/*
        The header is the root's: breadcrumb with the template switcher as its
        leaf, the test-send button on the right. Test sends deliver rendered HTML
        to an inbox — an email-only affordance, so no other channel gets the
        button.
      */}
      <PageChrome
        breadcrumb={
          <Breadcrumb
            items={[
              { label: t('nav.templates'), to: '/templates' },
              {
                label: options.find((option) => option.value === key)?.label ?? key,
                to: '/templates/$key',
                params: { key },
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
        actions={
          !isEmail ? undefined : (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!canTest}
              title={config.sendTest === undefined ? t('emails.testUnavailable') : undefined}
              onClick={() => setTestOpen(true)}
            >
              <Send size={16} strokeWidth={2} aria-hidden />
              {t('emails.test')}
            </Button>
          )
        }
      />
      <div className="flex flex-1 flex-col">
        <TemplatesPage
          refs={refs}
          emails={emails}
          pushes={pushes}
          slack={config.slack}
          discord={config.discord}
          {...(config.title !== undefined ? { appName: config.title } : {})}
          defaultScheme={studioScheme}
          selected={key}
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
      </div>

      <Modal
        visible={testOpen}
        disabled={sending}
        onCancel={() => setTestOpen(false)}
        className="w-100 p-6"
      >
        <ModalTitle>{t('emails.testTitle')}</ModalTitle>
        <p className="text-secondary mt-2 text-sm">{t('emails.testHint')}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendTest();
          }}
        >
          <label className="mt-4 block">
            <span className="text-secondary mb-1.5 block text-sm">{t('emails.to')}</span>
            <Input
              type="email"
              required
              className="w-full"
              placeholder="you@example.com"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={sending}
              onClick={() => setTestOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button size="sm" type="submit" disabled={sending || testTo.trim() === ''}>
              {sending ? t('emails.sending') : t('emails.send')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export const emailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates/$key',
  component: EmailView,
});
