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
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
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
  /**
   * Leading glyph, echoed on the trigger for the selected option. Optional
   * because a set with no natural iconography (Daily / Weekly / Monthly) is
   * better bare than fitted with a decorative stand-in.
   */
  icon?: LucideIcon;
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
  const SelectedIcon = selected?.icon;

  return (
    <>
      <Button
        ref={refs.setReference}
        size="sm"
        variant="outline"
        className={cn(
          /* `Button` is medium by default; a switcher reads as a value, not a command. */
          'min-w-0 justify-between gap-1.5 font-normal',
          selected === undefined && 'text-placeholder',
          className
        )}
        {...getReferenceProps()}
      >
        {/* Icon and label travel together; `justify-between` only pushes the chevron away. */}
        <span className="flex min-w-0 items-center gap-1.5">
          {SelectedIcon !== undefined && (
            <SelectedIcon
              size={16}
              strokeWidth={2}
              aria-hidden
              className="text-secondary shrink-0"
            />
          )}
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </span>
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
            {options.map((option, index) => {
              const OptionIcon = option.icon;
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  ref={(node) => {
                    listRef.current[index] = node;
                  }}
                  role="option"
                  aria-selected={isSelected}
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
                  {OptionIcon !== undefined && (
                    <OptionIcon
                      size={16}
                      strokeWidth={2}
                      aria-hidden
                      className="text-secondary shrink-0"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    {/* One weight for every option: the accent check is what
                        marks the current value, and a bolder label on top of
                        it says the same thing twice. */}
                    <span className="text-primary block truncate text-sm">{option.label}</span>
                    {option.description !== undefined && option.description !== '' && (
                      <span className="text-muted block truncate text-xs">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <Check size={16} strokeWidth={2} aria-hidden className="text-accent shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}
