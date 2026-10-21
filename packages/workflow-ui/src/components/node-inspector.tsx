import type { ConditionIR, NodeIR } from '@shware/workflow';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { superellipse } from './corner-shape';

/**
 * Details for one canvas node: its parameters, the literals inside its
 * conditions, and where in source it was built.
 *
 * Read-only by design. Source is edited in the editor; Vite picks the change
 * up and the canvas redraws, so the panel only ever reflects what is on disk.
 */
export interface NodeSource {
  /** Path on disk, relative to the project. */
  file: string;
  line: number;
}

export interface NodeInspectorProps {
  node: NodeIR;
  /**
   * Where the node was built, resolved by the host. Optional: a lookup that
   * fails or is still pending just leaves the row out.
   */
  source?: NodeSource;
  onClose: () => void;
  /**
   * What the node sends, rendered: an email thumbnail for a message node. The
   * host owns the template registry and the render, so it passes the result.
   */
  preview?: ReactNode;
}

/** Label / value row, matching the email envelope table. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-secondary">{children}</dd>
    </>
  );
}

/** The scalar parameters a node shows. Union rather than string, so the i18n key stays statically checked. */
export type NodeFieldKey =
  | 'duration'
  | 'min'
  | 'max'
  | 'timeout'
  | 'from'
  | 'to'
  | 'tz'
  | 'reason'
  | 'value'
  | 'within'
  | 'count';

export interface NodeField {
  /** i18n key under `inspector.field`. */
  key: NodeFieldKey;
  value: string;
  /** Shown before the label when the field belongs to a condition, not the node. */
  scope?: string | undefined;
}

export function ownFieldsOf(node: NodeIR): NodeField[] {
  switch (node.type) {
    case 'delay':
      return [{ key: 'duration', value: node.duration.value }];
    case 'random_delay':
      return [
        { key: 'min', value: node.min.value },
        { key: 'max', value: node.max.value },
      ];
    case 'wait_until':
      return [{ key: 'timeout', value: node.timeout.value }];
    case 'time_window':
      return [
        { key: 'from', value: node.between[0] },
        { key: 'to', value: node.between[1] },
        { key: 'tz', value: node.tz },
      ];
    case 'filter':
      return node.reason === undefined ? [] : [{ key: 'reason', value: node.reason }];
    case 'exit':
      return node.reason === undefined ? [] : [{ key: 'reason', value: node.reason }];
    default:
      return [];
  }
}

/**
 * Literals inside a node's condition — `eq(u.plan, 'pro')` shows `pro`,
 * `performed(e.login, { within: '7 days' })` shows the window. The property
 * path and the event are already on the canvas card, so only the values are
 * listed here.
 */
function conditionFields(condition: ConditionIR, scope: string): NodeField[] {
  const own: NodeField[] = [];

  if (
    (condition.type === 'property' || condition.type === 'payload') &&
    condition.value !== undefined
  ) {
    own.push({ key: 'value', value: String(condition.value), scope });
  }
  if (condition.type === 'performed') {
    if (condition.within !== undefined) {
      own.push({ key: 'within', value: condition.within.value, scope });
    }
    if (condition.count !== undefined) {
      own.push({ key: 'count', value: String(condition.count), scope });
    }
  }

  if (condition.type === 'and' || condition.type === 'or') {
    return [
      ...own,
      ...condition.conditions.flatMap((child, index) =>
        conditionFields(child, `${scope}[${index}]`)
      ),
    ];
  }
  if (condition.type === 'not') return [...own, ...conditionFields(condition.condition, scope)];
  return own;
}

/** Every field a node shows: its own scalars plus the literals inside its conditions. */
export function fieldsOf(node: NodeIR): NodeField[] {
  return [...ownFieldsOf(node), ...conditionFieldsOf(node)];
}

/** Conditions attached to a node, flattened with a label saying which one. */
export function conditionFieldsOf(node: NodeIR): NodeField[] {
  switch (node.type) {
    case 'filter':
      return conditionFields(node.condition, 'filter');
    case 'wait_until':
      return conditionFields(node.condition, 'until');
    case 'branch':
      return node.cases.flatMap((branchCase, index) =>
        conditionFields(branchCase.condition, branchCase.label ?? `case ${index}`)
      );
    default:
      return [];
  }
}

/** Read-only summary rows, per node type. */
function summary(node: NodeIR): { label: string; value: string }[] {
  switch (node.type) {
    case 'message':
      return [
        { label: 'channel', value: node.channel },
        { label: 'template', value: node.template },
      ];
    case 'branch':
      return node.cases.map((branchCase, index) => ({
        label: `case ${index}`,
        value: branchCase.label ?? '—',
      }));
    case 'cohort':
      // Weights are percentages in the IR (they sum to 100), as the canvas prints them
      return node.arms.map((arm) => ({
        label: arm.name,
        value: `${arm.weight}%`,
      }));
    case 'send_event':
      return [{ label: 'event', value: node.event }];
    case 'action':
      return [{ label: 'action', value: node.action }];
    default:
      return [];
  }
}

export function NodeInspector({ node, source, onClose, preview }: NodeInspectorProps) {
  const { t } = useTranslation();
  const fields = fieldsOf(node);

  return (
    <aside
      className="flex max-h-full w-80 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_4px_12px_var(--color-card-shadow)]"
      style={superellipse}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 pr-2.5 pl-4">
        <span className="flex-1 text-sm font-semibold text-primary">
          {t(`inspector.type.${node.type}`)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-primary"
          style={superellipse}
          aria-label={t('inspector.close')}
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 pt-0">
        {preview}

        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
          <Field label={t('inspector.id')}>
            <span className="font-mono text-xs">{node.id}</span>
          </Field>
          {node.label !== undefined && <Field label={t('inspector.label')}>{node.label}</Field>}
          {summary(node).map((row) => (
            <Field key={row.label} label={row.label}>
              <span className="font-mono text-xs">{row.value}</span>
            </Field>
          ))}
          {fields.map((field, index) => (
            <Field
              key={`${field.scope ?? ''}:${field.key}:${index}`}
              label={
                field.scope === undefined
                  ? t(`inspector.field.${field.key}`)
                  : `${field.scope} · ${t(`inspector.field.${field.key}`)}`
              }
            >
              <span className="font-mono text-xs">{field.value}</span>
            </Field>
          ))}
          {source !== undefined && (
            <Field label={t('inspector.source')}>
              <span className="font-mono text-xs">
                {source.file}:{source.line}
              </span>
            </Field>
          )}
        </dl>
      </div>
    </aside>
  );
}
