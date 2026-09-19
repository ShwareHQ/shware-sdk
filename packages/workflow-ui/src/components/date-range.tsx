import {
  FloatingFocusManager,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { Calendar } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';
import { Button } from './button';
import { superellipse } from './corner-shape';
import { Input } from './input';

/**
 * The range every panel on the Overview reads from. Both ends are inclusive
 * ISO `YYYY-MM-DD` days — the same shape the stats contract takes, so the
 * picker's value can be handed straight to a query.
 */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * A local calendar day, not a UTC instant. `toISOString().slice(0, 10)` is the
 * usual shortcut and it is wrong west of Greenwich for most of the day: it
 * reports yesterday, so "last 30 days" silently ends a day early.
 */
export function isoDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parse an ISO day back to local midnight — `new Date(iso)` would read it as UTC. */
export function parseIsoDay(iso: string): Date {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** The inclusive range of the `count` days ending today. */
export function lastDays(count: number): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (count - 1));
  return { from: isoDay(from), to: isoDay(to) };
}

/** 'Aug 21, 2026' — the compact form, for the toolbar trigger. */
export function formatDay(iso: string, locale: string): string {
  return parseIsoDay(iso).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** 'August 21, 2026' — the long form, for a card's subtitle. */
export function formatDayLong(iso: string, locale: string): string {
  return parseIsoDay(iso).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const PRESETS = [7, 14, 30, 90] as const;

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

/**
 * Presets plus two date fields, rather than a drawn calendar.
 *
 * Reporting ranges are chosen by duration ("the last month"), not by hunting
 * for a Tuesday, so the presets answer nearly every case; the two fields cover
 * the rest at a fraction of a calendar widget's weight — and the native picker
 * they carry is already localized and keyboard-accessible.
 */
export function DateRangePicker({ value, onChange, className }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ]);

  /* An inverted range is never what was meant; pin the other end to the edit. */
  const setFrom = (from: string) => onChange({ from, to: from > value.to ? from : value.to });
  const setTo = (to: string) => onChange({ from: to < value.from ? to : value.from, to });

  return (
    <>
      <Button
        ref={refs.setReference}
        size="sm"
        variant="outline"
        className={cn('gap-2 font-normal', className)}
        {...getReferenceProps()}
      >
        <Calendar size={16} strokeWidth={2} aria-hidden className="text-secondary shrink-0" />
        <span className="tabular-nums">
          {formatDay(value.from, i18n.language)} – {formatDay(value.to, i18n.language)}
        </span>
      </Button>
      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, ...superellipse }}
            className="border-border bg-card shadow-card-shadow z-50 w-64 rounded-xl border p-2 shadow-lg"
            {...getFloatingProps()}
          >
            {PRESETS.map((days) => (
              <button
                key={days}
                type="button"
                className="hover:bg-hover block w-full rounded-lg px-2.5 py-1.5 text-left text-sm"
                style={superellipse}
                onClick={() => {
                  onChange(lastDays(days));
                  setOpen(false);
                }}
              >
                {t('metrics.range.lastDays', { count: days })}
              </button>
            ))}
            <div className="border-border mt-2 space-y-2 border-t pt-2">
              <label className="block">
                <span className="text-muted text-xs">{t('metrics.range.from')}</span>
                <Input
                  size="sm"
                  type="date"
                  max={value.to}
                  value={value.from}
                  className="mt-1 w-full"
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-muted text-xs">{t('metrics.range.to')}</span>
                <Input
                  size="sm"
                  type="date"
                  min={value.from}
                  value={value.to}
                  className="mt-1 w-full"
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
            </div>
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}
