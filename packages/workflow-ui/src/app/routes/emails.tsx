import { render } from '@react-email/render';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { type ReactElement, createElement, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '../../components/button';
import { superellipse } from '../../components/corner-shape';
import { Dropdown } from '../../components/dropdown';
import { EmailList, type EmailListItem } from '../../components/email-list';
import { Input } from '../../components/input';
import { SearchInput } from '../../components/input/search-input';
import { Modal, ModalTitle } from '../../components/modal';
import { Tabs } from '../../components/tabs';
import { collectTemplateRefs } from '../../components/template-refs';
import { TemplatesPage } from '../../components/templates-page';
import { Textarea } from '../../components/textarea';
import type { EmailModule } from '../../config';
import { displayName } from '../../utils/label';
import { lookup } from '../../utils/lookup';
import { reportSave, studioPost } from '../studio';
import { Route as rootRoute } from './__root';

/* ---------------------------------- List ---------------------------------- */

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
      const mod = lookup(config.emails, ref.key);
      const item: EmailListItem = { key: ref.key, registered: mod !== undefined };
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
      <div className="text-muted flex h-full items-center justify-center text-sm">
        {t('emails.empty')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
        <h1 className="text-lg font-semibold">{t('emails.title')}</h1>
        <SearchInput
          className="w-64"
          placeholder={t('emails.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1">
        {filtered.length === 0 ? (
          <div className="text-muted flex h-full items-center justify-center text-sm">
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

const TABS = [{ to: '/templates/$key', label: 'emails.tabs.preview', exact: true }] as const;

function EmailView() {
  const { key } = emailRoute.useParams();
  const { config } = emailRoute.useRouteContext();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [sending, setSending] = useState(false);

  const refs = useMemo(
    () => collectTemplateRefs(Object.values(config.workflows).map((builder) => builder.toIR())),
    [config]
  );
  const emails = config.emails;
  const selected = lookup(emails, key);
  const { data, error, isPending } = useEmailPreview(selected, key);

  /* Switcher options: every referenced template, labelled by its module name. */
  const options = useMemo(
    () =>
      refs.map((ref) => ({
        value: ref.key,
        label: displayName(lookup(emails, ref.key)?.name, ref.key),
      })),
    [refs, emails]
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border bg-card grid h-15 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/templates"
            className="text-muted hover:bg-hover flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={superellipse}
            aria-label={t('common.back')}
          >
            <ArrowLeft className="size-4" strokeWidth={2} />
          </Link>
          <Dropdown
            className="max-w-full"
            value={key}
            options={options}
            onChange={(next) => void navigate({ to: '/templates/$key', params: { key: next } })}
          />
        </div>
        <Tabs
          items={TABS.map((tab) => ({ to: tab.to, label: t(tab.label), exact: tab.exact }))}
          params={{ key }}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!canTest}
            title={config.sendTest === undefined ? t('emails.testUnavailable') : undefined}
            onClick={() => setTestOpen(true)}
          >
            {t('emails.test')}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <TemplatesPage
          refs={refs}
          emails={emails}
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
