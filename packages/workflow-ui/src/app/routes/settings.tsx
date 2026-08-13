import { zodResolver } from '@hookform/resolvers/zod';
import { createRoute } from '@tanstack/react-router';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/button';
import { superellipse } from '../../components/corner-shape';
import { type AddressForm, addressSchema } from '../address';
import {
  type SupportedLng,
  languageNames,
  supportedLngs,
} from '../integrations/i18n/root-provider';
import { type Theme, themes, useTheme } from '../integrations/theme/root-provider';
import { reportSave, studioPost } from '../studio';
import { Route as rootRoute } from './__root';

const inputClass =
  'border-border bg-card w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none';

/** One-field address form: react-hook-form + the shared zod schema; errors render under the input. */
function useAddressForm(defaultValue: string) {
  const { t } = useTranslation();
  return useForm<AddressForm>({
    resolver: zodResolver(addressSchema(t('settings.addressInvalid'))),
    defaultValues: { address: defaultValue },
  });
}

function FieldError({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return <p className="mt-1 text-xs text-red-500">{message}</p>;
}

/** Inline editor for one existing address. Its own form instance, so each row validates alone. */
function EditAddressRow({
  address,
  onSave,
  onCancel,
}: {
  address: string;
  onSave: (next: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const form = useAddressForm(address);
  const submit = form.handleSubmit(({ address: next }) => {
    if (next.trim() === address) onCancel();
    else onSave(next.trim());
  });

  return (
    <form onSubmit={(event) => void submit(event)} className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <input
            autoFocus
            {...form.register('address')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onCancel();
            }}
            aria-invalid={form.formState.errors.address !== undefined}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          title={t('settings.addressSave')}
          className="text-muted hover:text-primary p-1"
        >
          <Check className="size-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          title={t('settings.addressCancel')}
          onClick={onCancel}
          className="text-muted hover:text-primary p-1"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </div>
      <FieldError message={form.formState.errors.address?.message} />
    </form>
  );
}

/**
 * The sender address book (workflow.config.ts's `emails.addresses`): the list
 * the from / reply-to pickers offer. Every action patches the config file —
 * the reload that follows brings the fresh list back through discovery.
 */
function AddressBook({ addresses }: { addresses: string[] }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const addForm = useAddressForm('');

  const save = (body: Record<string, unknown>) =>
    reportSave(studioPost('/__studio/addresses', body), {
      saved: t('emails.saved'),
      failed: t('emails.saveFailed'),
    });

  const submitAdd = addForm.handleSubmit(({ address }) => {
    addForm.reset();
    void save({ action: 'add', address: address.trim() });
  });

  return (
    <section
      className="border-border bg-card mt-4 max-w-xl rounded-2xl border p-5"
      style={superellipse}
    >
      <h2 className="text-sm font-medium">{t('settings.addresses')}</h2>
      <p className="text-muted mt-1 text-xs">{t('settings.addressesHint')}</p>

      <ul className="mt-3 flex flex-col gap-1">
        {addresses.map((address) => (
          <li key={address} className="group flex min-h-9 items-center gap-2">
            {editing === address ? (
              <EditAddressRow
                address={address}
                onCancel={() => setEditing(undefined)}
                onSave={(next) => {
                  setEditing(undefined);
                  void save({ action: 'update', address, newAddress: next });
                }}
              />
            ) : (
              <>
                <span className="text-secondary min-w-0 flex-1 truncate text-sm">{address}</span>
                <button
                  type="button"
                  title={t('settings.addressEdit')}
                  onClick={() => setEditing(address)}
                  className="text-muted hover:text-primary p-1 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Pencil className="size-4" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  title={t('settings.addressRemove')}
                  onClick={() => void save({ action: 'remove', address })}
                  className="text-muted p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
                >
                  <Trash2 className="size-4" strokeWidth={2} />
                </button>
              </>
            )}
          </li>
        ))}
        {addresses.length === 0 && (
          <li className="text-muted text-sm">{t('common.notConfigured')}</li>
        )}
      </ul>

      <form onSubmit={(event) => void submitAdd(event)} className="mt-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <input
              {...addForm.register('address')}
              placeholder={t('settings.addressPlaceholder')}
              aria-invalid={addForm.formState.errors.address !== undefined}
              className={inputClass}
            />
          </div>
          <Button size="sm" variant="secondary" type="submit">
            <Plus className="size-4" strokeWidth={2} />
            {t('settings.addressAdd')}
          </Button>
        </div>
        <FieldError message={addForm.formState.errors.address?.message} />
      </form>
    </section>
  );
}

function Settings() {
  const { config } = settingsRoute.useRouteContext();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();

  const current = supportedLngs.find((lng) => i18n.resolvedLanguage === lng) ?? 'en-US';
  const sources = (['reports', 'nodeStats', 'metrics'] as const).filter(
    (key) => config.stats?.[key] !== undefined
  );

  return (
    <div className="h-full overflow-auto p-6">
      <h1 className="text-lg font-semibold">{t('settings.title')}</h1>

      <section
        className="border-border bg-card mt-5 max-w-xl rounded-2xl border p-5"
        style={superellipse}
      >
        <h2 className="text-sm font-medium">{t('settings.language')}</h2>
        <p className="text-muted mt-1 text-xs">{t('settings.languageHint')}</p>
        <div className="mt-3 flex gap-2">
          {supportedLngs.map((lng: SupportedLng) => (
            <Button
              key={lng}
              size="sm"
              variant={current === lng ? 'default' : 'secondary'}
              onClick={() => void i18n.changeLanguage(lng)}
            >
              {languageNames[lng]}
            </Button>
          ))}
        </div>
      </section>

      <section
        className="border-border bg-card mt-4 max-w-xl rounded-2xl border p-5"
        style={superellipse}
      >
        <h2 className="text-sm font-medium">{t('settings.theme')}</h2>
        <p className="text-muted mt-1 text-xs">{t('settings.themeHint')}</p>
        <div className="mt-3 flex gap-2">
          {themes.map((option: Theme) => (
            <Button
              key={option}
              size="sm"
              variant={theme === option ? 'default' : 'secondary'}
              onClick={() => setTheme(option)}
            >
              {t(`settings.themes.${option}`)}
            </Button>
          ))}
        </div>
      </section>

      <AddressBook addresses={config.addresses} />

      <section
        className="border-border bg-card mt-4 max-w-xl rounded-2xl border p-5"
        style={superellipse}
      >
        <h2 className="text-sm font-medium">{t('settings.statsSource')}</h2>
        <p className="text-secondary mt-2 font-mono text-xs">
          {sources.length > 0 ? sources.join(', ') : t('common.notConfigured')}
        </p>
      </section>
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
});
