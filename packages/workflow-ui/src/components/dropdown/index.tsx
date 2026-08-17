import {
  FloatingFocusManager,
  autoUpdate,
  flip,
  offset,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from '@floating-ui/react';
import { Check, ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '../../utils/cn';
import { Button } from '../button';
import { superellipse } from '../corner-shape';

/**
 * Custom select for header switchers, built on floating-ui rather than a
 * native `<select>`: the options carry a second, de-emphasised description
 * line, which native popups cannot render. The trigger is deliberately
 * flat — no fill until hover — so it reads as part of the header, not a form.
 */
export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  value?: string;
  options: DropdownOption[];
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Dropdown({ value, options, onChange, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(160, availableHeight)}px`;
        },
      }),
    ],
  });

  const listRef = useRef<(HTMLElement | null)[]>([]);
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'listbox' }),
    useListNavigation(context, { listRef, activeIndex, onNavigate: setActiveIndex }),
  ]);

  const selected = options.find((option) => option.value === value);

  return (
    <>
      <Button
        ref={refs.setReference}
        size="sm"
        variant="outline"
        className={cn(
          'min-w-0 justify-between gap-1.5',
          selected === undefined && 'text-placeholder',
          className
        )}
        {...getReferenceProps()}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown size={16} strokeWidth={2} aria-hidden className="text-secondary shrink-0" />
      </Button>
      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className={cn(
              'border-border bg-card z-50 max-w-96 min-w-64 overflow-y-auto rounded-xl border p-1',
              'shadow-card-shadow shadow-lg'
            )}
            {...getFloatingProps()}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                ref={(node) => {
                  listRef.current[index] = node;
                }}
                role="option"
                aria-selected={option.value === value}
                tabIndex={activeIndex === index ? 0 : -1}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left',
                  activeIndex === index && 'bg-selected'
                )}
                style={superellipse}
                {...getItemProps({
                  onClick() {
                    onChange?.(option.value);
                    setOpen(false);
                  },
                })}
              >
                <span className="min-w-0 flex-1">
                  <span className="text-primary block truncate text-sm font-medium">
                    {option.label}
                  </span>
                  {option.description !== undefined && option.description !== '' && (
                    <span className="text-muted block truncate text-xs">{option.description}</span>
                  )}
                </span>
                {option.value === value && (
                  <Check size={16} strokeWidth={2} aria-hidden className="text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}
