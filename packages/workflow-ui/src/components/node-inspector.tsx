import type { ConditionIR, NodeIR } from '@shware/workflow';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';
import { superellipse } from './corner-shape';

/**
 * Details for one canvas node, and — where the value is one literal in source —
 * an input that edits it.
 *
 * Presentational: the host resolves the source position and performs the save,
 * so an embedding app can wire this to its own backend or leave it read-only.
 */
export interface NodeSource {
  /** Path on disk, relative to the project. */
  file: string;
  line: number;
  /** False when the value is an expression rather than a literal. */
  editable: boolean;
}

export interface NodeInspectorProps {
  node: NodeIR;
  /** Resolved source position per field path, keyed by `path.join('.')`. */
  sources?: Record<string, NodeSource>;
  /**
   * How many nodes this node's call site built. Above one, the call is shared —
   * a helper reused across arms — and an edit here reaches all of them.
   */
  sharedBy?: number;
  onClose: () => void;
  /** Save a new value for one field. Omit to keep the panel read-only. */
  onSave?: (field: EditableField, value: string) => Promise<void>;
}

/** Label / value row, matching the email envelope table. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted whitespace-nowrap">{label}</dt>
      <dd className="text-secondary min-w-0 break-words">{children}</dd>
    </>
  );
}

/**
 * The scalars a node exposes for editing, each with the path to its literal in
 * the call that built it (see ValuePath in server/patch.ts).
 *
 * Only values that are total, literal-backed and id-stable appear here — the
 * policy and the exclusions are documented at the top of server/patch.ts. A
 * field listed here can still come back read-only: the server has the last word,
 * because only it can see whether the source really holds a literal there.
 */
/** Union rather than string, so the i18n key stays statically checked. */
export type EditableFieldKey =
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

export interface EditableField {
  /** i18n key under `inspector.field`. */
  key: EditableFieldKey;
  value: string;
  path: (string | number)[];
  /**
   * Whose call site the path is relative to. A node's own fields resolve against
   * the call that built the node; a condition's resolve against the predicate
   * call inside it, which carries its own loc.
   */
  loc?: { file: string; line: number; column: number } | undefined;
  /** Shown before the input when the field belongs to a condition, not the node. */
  scope?: string | undefined;
}

export function editableFieldsOf(node: NodeIR): EditableField[] {
  switch (node.type) {
    case 'delay':
      return [{ key: 'duration', value: node.duration.value, path: [0] }];
    case 'random_delay':
      return [
        { key: 'min', value: node.min.value, path: [0, 'min'] },
        { key: 'max', value: node.max.value, path: [0, 'max'] },
      ];
    case 'wait_until':
      return [{ key: 'timeout', value: node.timeout.value, path: [1, 'timeout'] }];
    case 'time_window':
      return [
        { key: 'from', value: node.between[0], path: [0, 'between', 0] },
        { key: 'to', value: node.between[1], path: [0, 'between', 1] },
        { key: 'tz', value: node.tz, path: [0, 'tz'] },
      ];
    case 'filter':
      return node.reason === undefined
        ? []
        : [{ key: 'reason', value: node.reason, path: [1, 'reason'] }];
    case 'exit':
      return node.reason === undefined ? [] : [{ key: 'reason', value: node.reason, path: [0] }];
    default:
      return [];
  }
}

/**
 * Literals inside a node's condition. Conditions carry their own provenance, so
 * each field resolves against the predicate that produced it — `eq(u.plan,
 * 'pro')` is one call with the value at argument 1, `performed(e.login, {
 * within: '7 days' })` puts it in the options object.
 *
 * Only the value slots are offered. The property path and the event are
 * identifier references into the schema table, and an identifier a text box can
 * misspell is an identifier that stops the project compiling.
 */
function conditionFields(condition: ConditionIR, scope: string): EditableField[] {
  const loc = condition.meta?.loc;
  const own: EditableField[] = [];

  if (loc !== undefined) {
    if (
      (condition.type === 'property' || condition.type === 'payload') &&
      condition.value !== undefined
    ) {
      own.push({ key: 'value', value: String(condition.value), path: [1], loc, scope });
    }
    if (condition.type === 'performed') {
      if (condition.within !== undefined) {
        own.push({
          key: 'within',
          value: condition.within.value,
          path: [1, 'within'],
          loc,
          scope,
        });
      }
      if (condition.count !== undefined) {
        own.push({ key: 'count', value: String(condition.count), path: [1, 'count'], loc, scope });
      }
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

/**
 * Every field a node offers: its own scalars plus the literals inside its
 * conditions. One list, so the host probes exactly what the panel renders —
 * they drifted apart once, and the panel silently showed everything read-only.
 */
export function fieldsOf(node: NodeIR): EditableField[] {
  return [...editableFieldsOf(node), ...conditionFieldsOf(node)];
}

/** Conditions attached to a node, flattened with a label saying which one. */
export function conditionFieldsOf(node: NodeIR): EditableField[] {
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
    case 'random_delay':
      return [
        { label: 'min', value: node.min.value },
        { label: 'max', value: node.max.value },
      ];
    case 'branch':
      return node.cases.map((branchCase, index) => ({
        label: `case ${index}`,
        value: branchCase.label ?? '—',
      }));
    case 'cohort':
      return node.arms.map((arm) => ({
        label: arm.name,
        value: `${arm.weight / 100}%`,
      }));
    case 'send_event':
      return [{ label: 'event', value: node.event }];
    default:
      return [];
  }
}

/** One editable scalar: an input plus its own save, since each has its own literal. */
function FieldEditor({
  field,
  source,
  sharedBy,
  onSave,
}: {
  field: EditableField;
  source: NodeSource | undefined;
  sharedBy?: number | undefined;
  onSave?: ((field: EditableField, value: string) => Promise<void>) | undefined;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(field.value);
  const [saving, setSaving] = useState(false);

  // The IR is rebuilt on every write-back reload; follow it rather than keeping a stale draft
  useEffect(() => setDraft(field.value), [field.value]);

  const canEdit = onSave !== undefined && source?.editable === true;
  const dirty = draft.trim() !== field.value && draft.trim() !== '';

  const save = () => {
    if (!canEdit || !dirty) return;
    setSaving(true);
    void onSave(field, draft.trim()).finally(() => setSaving(false));
  };

  return (
    <div className="mb-4">
      <label
        className="text-muted mb-1.5 block text-xs"
        htmlFor={`node-${field.scope ?? ''}-${field.key}`}
      >
        {field.scope !== undefined && <span className="font-mono">{field.scope} · </span>}
        {t(`inspector.field.${field.key}`)}
      </label>
      <input
        id={`node-${field.scope ?? ''}-${field.key}`}
        value={draft}
        disabled={!canEdit || saving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && save()}
        className={clsx(
          'border-border bg-page text-primary h-9 w-full rounded-lg border px-3 text-sm',
          'focus:border-accent outline-none disabled:opacity-60'
        )}
        style={superellipse}
      />
      {sharedBy !== undefined && sharedBy > 1 && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
          {t('inspector.shared', { count: sharedBy })}
        </p>
      )}
      {canEdit ? (
        dirty && (
          <Button size="sm" className="mt-2 w-full" disabled={saving} onClick={save}>
            {t('inspector.save')}
          </Button>
        )
      ) : (
        <p className="text-muted mt-1.5 text-xs">{t('inspector.readOnly')}</p>
      )}
    </div>
  );
}

export function NodeInspector({ node, sources, sharedBy, onClose, onSave }: NodeInspectorProps) {
  const { t } = useTranslation();
  const fields = fieldsOf(node);

  return (
    <aside className="border-border bg-card flex w-80 shrink-0 flex-col border-l">
      <div className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <span className="text-primary flex-1 text-sm font-semibold">
          {t(`inspector.type.${node.type}`)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:bg-hover hover:text-primary flex size-7 items-center justify-center rounded-lg transition-colors"
          style={superellipse}
          aria-label={t('inspector.close')}
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {fields.map((field) => (
          <FieldEditor
            key={`${field.scope ?? ''}:${field.key}:${field.path.join('.')}`}
            field={field}
            source={sources?.[`${field.scope ?? ''}:${field.path.join('.')}`]}
            {...(sharedBy !== undefined ? { sharedBy } : {})}
            {...(onSave !== undefined ? { onSave } : {})}
          />
        ))}

        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
          <Field label={t('inspector.id')}>
            <span className="font-mono text-sm">{node.id}</span>
          </Field>
          {node.label !== undefined && <Field label={t('inspector.label')}>{node.label}</Field>}
          {summary(node).map((row) => (
            <Field key={row.label} label={row.label}>
              <span className="font-mono text-sm">{row.value}</span>
            </Field>
          ))}
          {sources !== undefined && Object.values(sources)[0] !== undefined && (
            <Field label={t('inspector.source')}>
              <span className="font-mono text-sm">
                {Object.values(sources)[0].file}:{Object.values(sources)[0].line}
              </span>
            </Field>
          )}
        </dl>
      </div>
    </aside>
  );
}
