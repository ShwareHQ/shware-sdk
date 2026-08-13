import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from './button';
import { superellipse } from './corner-shape';

/**
 * The sender address book: the list the from / reply-to pickers offer.
 * A pure component — the host wires the callbacks to whatever persists the
 * list (the studio patches workflow.config.ts and lets the reload refresh it).
 */

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Two accepted shapes: a bare email, or the display-name form `Acme <hello@acme.io>`. */
export function isValidEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (EMAIL.test(trimmed)) return true;
  const named = /^(.+?)\s*<([^<>]+)>$/.exec(trimmed);
  return named !== null && named[1]?.trim() !== '' && EMAIL.test(named[2] ?? '');
}

/** react-hook-form schema for a single address field; the message is the caller's translation. */
export const addressSchema = (invalidMessage: string) =>
  z.object({
    address: z.string().trim().min(1, invalidMessage).refine(isValidEmailAddress, invalidMessage),
  });

export type AddressForm = { address: string };

export interface AddressBookProps {
  addresses: string[];
  onAdd: (address: string) => void;
  onUpdate: (address: string, newAddress: string) => void;
  onRemove: (address: string) => void;
}

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

export function AddressBook({ addresses, onAdd, onUpdate, onRemove }: AddressBookProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const addForm = useAddressForm('');

  const submitAdd = addForm.handleSubmit(({ address }) => {
    addForm.reset();
    onAdd(address.trim());
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
                  onUpdate(address, next);
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
                  onClick={() => onRemove(address)}
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
