import { Check, ChevronDown, Copy, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Profile } from '../config';
import { cn } from '../utils/cn';
import { superellipse } from './corner-shape';
import { Flag } from './flag';

/**
 * A profile's full record, in a panel over the right edge.
 *
 * A drawer rather than a route because the list is the context: you scan the
 * table, open one person to check a property, and go back to scanning. Pushing
 * that through navigation would lose the scroll position every time.
 *
 * Properties are grouped into the analytics package's tag families (source,
 * device, utm — see TrackTags) plus the identity fields; anything the schema
 * does not know lands in Others, so nothing a project stores is ever hidden.
 * All keys are snake_case, matching how the SDK writes user properties.
 */
export interface ProfileDrawerProps {
  profile: Profile | undefined;
  onClose: () => void;
}

/** Property keys per section, in display order. Labels come from i18n by the same key. */
const SOURCE_FIELDS = [
  'country',
  'region',
  'city',
  'platform',
  'language',
  'time_zone',
  'release',
] as const;
const DEVICE_FIELDS = [
  'device',
  'os',
  'browser',
  'screen_resolution',
  'device_pixel_ratio',
] as const;
/* Identity keys consumed by the User Data section rather than listed in Others. */
const USER_FIELDS = ['name', 'first_name', 'last_name', 'email', 'company'];

/** Values come from the user's own store, so render them without assuming a shape. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/** One collapsible family of rows; the chevron mirrors the envelope panel's. */
function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-border border-b py-4 first:pt-0 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-primary text-sm font-semibold">{title}</span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          aria-hidden
          className={cn('text-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <dl className="mt-3 grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-2 text-sm">
          {children}
        </dl>
      )}
    </section>
  );
}

/** Label left, value right-aligned; missing values render as a dash. */
function Row({
  label,
  value,
  action,
  leading,
}: {
  label: string;
  value: unknown;
  action?: ReactNode;
  /** Sits just before the value — the country row's flag. */
  leading?: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted whitespace-nowrap">{label}</dt>
      <dd className="text-secondary flex min-w-0 items-center justify-end gap-1.5">
        {leading}
        <span className="min-w-0 truncate text-right" title={formatValue(value)}>
          {formatValue(value)}
        </span>
        {action}
      </dd>
    </>
  );
}

/** Copy-to-clipboard tail for identity rows, flipping to a check as feedback. */
function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            /* Clipboard API can be permission-gated (embedded webviews); fall back. */
            const area = document.createElement('textarea');
            area.value = value;
            document.body.append(area);
            area.select();
            document.execCommand('copy');
            area.remove();
          }
          setCopied(true);
        })();
      }}
      className="text-muted hover:bg-hover hover:text-primary flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
      style={superellipse}
    >
      {copied ? (
        <Check size={14} strokeWidth={2} aria-hidden />
      ) : (
        <Copy size={14} strokeWidth={2} aria-hidden />
      )}
    </button>
  );
}

export function ProfileDrawer({ profile, onClose }: ProfileDrawerProps) {
  const { t } = useTranslation();
  const open = profile !== undefined;
  /* Closed sections by title key; everything starts expanded, like the reference. */
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setClosed((state) => ({ ...state, [key]: !state[key] }));

  /* Escape closes it: the panel is a detail view, not a decision the user is trapped in. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const properties = profile?.properties ?? {};
  const prop = (key: string) => properties[key];

  /* Identity, assembled with fallbacks: `name`, else first + last. */
  const name =
    prop('name') ??
    ([prop('first_name'), prop('last_name')]
      .filter((part): part is string => typeof part === 'string')
      .join(' ') ||
      undefined);
  const email = profile?.email ?? prop('email');

  const utmKeys = Object.keys(properties).filter((key) => key.startsWith('utm_'));
  const consumed = new Set([...USER_FIELDS, ...SOURCE_FIELDS, ...DEVICE_FIELDS, ...utmKeys]);
  const others = Object.entries(properties).filter(([key]) => !consumed.has(key));

  /* Copy only rows that hold a real value; a dash is nothing to copy. */
  const copyAction = (value: unknown) =>
    typeof value === 'string' && value !== '' ? (
      <CopyButton label={t('profiles.copy')} value={value} />
    ) : undefined;

  return (
    <>
      {/* The scrim only exists while open, so it never eats clicks on the table. */}
      {open && (
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="absolute inset-0 z-20 cursor-default bg-gray-950/20 dark:bg-gray-950/50"
        />
      )}

      <aside
        aria-hidden={!open}
        className={`border-border bg-card absolute inset-y-0 right-0 z-30 flex w-96 max-w-full flex-col border-l shadow-xl transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{profile?.email ?? profile?.id}</div>
            <div className="text-muted truncate font-mono text-xs">{profile?.id}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-muted hover:bg-hover hover:text-primary flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={superellipse}
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5">
          <div className="py-4">
            <Section
              title={t('profiles.sections.user')}
              open={!closed.user}
              onToggle={() => toggle('user')}
            >
              <Row label={t('profiles.id')} value={profile?.id} action={copyAction(profile?.id)} />
              <Row label={t('profiles.fields.name')} value={name} action={copyAction(name)} />
              <Row label={t('profiles.email')} value={email} action={copyAction(email)} />
              <Row
                label={t('profiles.fields.company')}
                value={prop('company')}
                action={copyAction(prop('company'))}
              />
            </Section>

            <Section
              title={t('profiles.sections.source')}
              open={!closed.source}
              onToggle={() => toggle('source')}
            >
              {SOURCE_FIELDS.map((key) => {
                const value = prop(key);
                const flag =
                  key === 'country' && typeof value === 'string' && value.length === 2 ? (
                    <Flag code={value} className="h-3 w-4 shrink-0 rounded-[2px]" />
                  ) : undefined;
                return (
                  <Row key={key} label={t(`profiles.fields.${key}`)} value={value} leading={flag} />
                );
              })}
            </Section>

            <Section
              title={t('profiles.sections.device')}
              open={!closed.device}
              onToggle={() => toggle('device')}
            >
              {DEVICE_FIELDS.map((key) => (
                <Row key={key} label={t(`profiles.fields.${key}`)} value={prop(key)} />
              ))}
            </Section>

            <Section
              title={t('profiles.sections.utm')}
              open={!closed.utm}
              onToggle={() => toggle('utm')}
            >
              {(utmKeys.length > 0
                ? utmKeys
                : ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']
              ).map((key) => (
                <Row key={key} label={key} value={prop(key)} />
              ))}
            </Section>

            {others.length > 0 && (
              <Section
                title={t('profiles.sections.others')}
                open={!closed.others}
                onToggle={() => toggle('others')}
              >
                {others.map(([key, value]) => (
                  <Row key={key} label={key} value={value} />
                ))}
              </Section>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
