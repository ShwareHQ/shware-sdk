import * as z from 'zod/mini';

/**
 * IR (Intermediate Representation) — what the DSL compiles to: serializable
 * JSON. It is the three-way contract between the engine that interprets it,
 * the UI (react-flow) that renders it, and diff / audit tooling.
 *
 * Validation strategy: the zod/mini schemas are the authoritative definition.
 * TS types are either inferred from a schema or hand-written under the same
 * name (zod cannot infer recursive types; the hand-written type is anchored
 * with a ZodMiniType<T> annotation, so any drift fails to compile). IR crosses
 * process boundaries (database, network, UI), so runtime validation is a must.
 *
 * ## Versioning (two independent axes)
 *
 * 1. IR format version (irVersion): evolution of the IR schema itself. Adding
 *    optional fields does not bump it; only structurally incompatible changes
 *    do (changing a discriminant, dropping a field, altering semantics).
 *    Readers dispatch on irVersion to the matching schema/migrator; writers
 *    always write the current version.
 * 2. Content version (contentHash): a content-addressed id for a single
 *    definition's **execution semantics** — the canonical-JSON hash after
 *    metadata (meta / label) is stripped, see hash.ts. It is used to:
 *    - pin a version when a user enters, so an in-flight journey runs the
 *      pinned version to completion (the default policy; compatible hot
 *      updates are a future explicit-migration topic). Known exception:
 *      segment conditions are resolved **by name at evaluation time** — a
 *      segment redeploy changes behaviour of in-flight journeys that
 *      reference it. Pinning covers the workflow's own structure; per-hash
 *      segment snapshots are future work;
 *    - diff on deploy: same hash means unchanged, skip publishing;
 *    - audit: answer "which version was this user on" at any point.
 *
 * ## Node ids
 *
 * Derived from the structural path at compile time — stable and deterministic:
 * root level '0', '1', …; the j-th child of a branch's i-th case is
 * '{branchId}.c{i}.{j}', the default arm '{branchId}.o.{j}'; cohort arms use
 * the arm name '{cohortId}.{armName}.{j}'; a waitUntil timeout flow '{id}.t.{j}'.
 * Editing a node's parameters keeps its id; inserting a node shifts the ids of
 * its later siblings (a known trade-off — locating in-flight users relies on
 * the pinned version rather than cross-version id alignment, and cross-version
 * mapping is an explicit migrator's job).
 */

export const IR_VERSION = 1;

/* -------------------------------- Base values ------------------------------- */

export const ScalarIR = z.union([z.string(), z.number(), z.boolean()]);
export type ScalarIR = z.infer<typeof ScalarIR>;

/** Duration: `value` keeps the DSL literal ('23 hours', for display), `ms` is what the engine uses. */
export const DurationIR = z.object({ value: z.string(), ms: z.number() });
export type DurationIR = z.infer<typeof DurationIR>;

/** User-property reference — isomorphic to the DSL's UserPropertyRef once serialized (phantom type dropped). */
export const UserPropertyRefIR = z.object({
  type: z.literal('user_property'),
  path: z.string(),
});
export type UserPropertyRefIR = z.infer<typeof UserPropertyRefIR>;

/** A message prop / event payload value: either a literal or a user-property reference. */
export const PropValueIR = z.union([ScalarIR, UserPropertyRefIR]);
export type PropValueIR = z.infer<typeof PropValueIR>;

export const ChannelIR = z.enum(['email', 'sms', 'push', 'in_app', 'slack', 'survey']);
export type ChannelIR = z.infer<typeof ChannelIR>;

export const WeekdayIR = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type WeekdayIR = z.infer<typeof WeekdayIR>;

/* -------------------------------- Conditions -------------------------------- */

export const PropertyOperatorIR = z.enum([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'not_between',
  'in_array',
  'not_in_array',
  'exists',
  'not_exists',
  'contains',
  'not_contains',
]);
export type PropertyOperatorIR = z.infer<typeof PropertyOperatorIR>;

/**
 * Condition expression tree. The shape of value/values follows `op`:
 * eq/ne/gt/gte/lt/lte/contains/not_contains → value; in_array/not_in_array →
 * values; between/not_between → values = [min, max]; exists/not_exists → neither.
 *
 * `payload` predicates test the payload of an event (dotted paths reach nested
 * fields). They are only valid inside a `where` subtree — `performed.where`
 * and the event trigger's `where` — where an event row is in scope; the
 * compiler (compileBundle) and the evaluator both enforce the placement.
 * TODO: runtime refinement narrowing by op.
 */
export type ConditionIR =
  | { type: 'and'; conditions: ConditionIR[] }
  | { type: 'or'; conditions: ConditionIR[] }
  | { type: 'not'; condition: ConditionIR }
  /** Reference a named segment by name (defined in SegmentIR, versioned separately). */
  | { type: 'segment'; segment: string }
  | {
      type: 'property';
      path: string;
      op: PropertyOperatorIR;
      value?: ScalarIR | undefined;
      values?: ScalarIR[] | undefined;
    }
  | {
      /** Event payload predicate; `path` is dotted for nested fields ('tags.utm_source'). */
      type: 'payload';
      path: string;
      op: PropertyOperatorIR;
      value?: ScalarIR | undefined;
      values?: ScalarIR[] | undefined;
    }
  | {
      type: 'performed';
      event: string;
      /** Payload filter: only events matching it count (a payload-only subtree). */
      where?: ConditionIR | undefined;
      within?: DurationIR | undefined;
      count?: number | undefined;
    };

export const ConditionIR: z.ZodMiniType<ConditionIR> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('and'), conditions: z.array(ConditionIR) }),
    z.object({ type: z.literal('or'), conditions: z.array(ConditionIR) }),
    z.object({ type: z.literal('not'), condition: ConditionIR }),
    z.object({ type: z.literal('segment'), segment: z.string() }),
    z.object({
      type: z.literal('property'),
      path: z.string(),
      op: PropertyOperatorIR,
      value: z.optional(ScalarIR),
      values: z.optional(z.array(ScalarIR)),
    }),
    z.object({
      type: z.literal('payload'),
      path: z.string(),
      op: PropertyOperatorIR,
      value: z.optional(ScalarIR),
      values: z.optional(z.array(ScalarIR)),
    }),
    z.object({
      type: z.literal('performed'),
      event: z.string(),
      where: z.optional(ConditionIR),
      within: z.optional(DurationIR),
      count: z.optional(z.number()),
    }),
  ])
);

/* --------------------------------- Triggers --------------------------------- */

/**
 * Trigger shapes. The event trigger has two independent gates: `where` tests
 * the triggering event's payload (payload-only subtree, evaluated against the
 * incoming event before anything else), `filter` tests the user's profile.
 */
export const TriggerIR = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('event'),
    event: z.string(),
    where: z.optional(ConditionIR),
    filter: z.optional(ConditionIR),
  }),
  z.object({ type: z.literal('segment'), segment: z.string() }),
  z.object({ type: z.literal('date'), at: z.string() }),
  z.object({ type: z.literal('webhook') }),
]);
export type TriggerIR = z.infer<typeof TriggerIR>;

/* --------------------------------- Provenance -------------------------------- */

/**
 * Source location of the builder call that produced a definition — the IR's
 * source map. Lives under `meta`, so it is **excluded from contentHash**
 * (see hash.ts): provenance never affects execution identity or plan.
 * `file` is cwd-relative when compiled under Node, a URL under Vite dev.
 */
export const SourceLocIR = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number(),
});
export type SourceLocIR = z.infer<typeof SourceLocIR>;

/** Node-level metadata: provenance only, for now. Excluded from contentHash. */
export const NodeMetaIR = z.object({
  loc: z.optional(SourceLocIR),
});
export type NodeMetaIR = z.infer<typeof NodeMetaIR>;

/* ----------------------------------- Nodes ---------------------------------- */

interface NodeBaseIR {
  /** Stable id derived from the structural path (rules in the file header). */
  id: string;
  /** Optional node name: UI title / observability handle (branch's optional first argument lands here). */
  label?: string | undefined;
  /** Metadata (provenance); excluded from contentHash. */
  meta?: NodeMetaIR | undefined;
}

export type NodeIR =
  | (NodeBaseIR & {
      type: 'message';
      channel: ChannelIR;
      template: string;
      props: Record<string, PropValueIR>;
    })
  | (NodeBaseIR & { type: 'delay'; duration: DurationIR })
  | (NodeBaseIR & { type: 'random_delay'; min: DurationIR; max: DurationIR })
  | (NodeBaseIR & {
      type: 'time_window';
      days: WeekdayIR[];
      between: [string, string];
      tz: string;
    })
  | (NodeBaseIR & {
      type: 'wait_until';
      condition: ConditionIR;
      timeout: DurationIR;
      onTimeout: 'continue' | 'exit' | NodeIR[];
    })
  | (NodeBaseIR & {
      type: 'branch';
      cases: { label?: string | undefined; condition: ConditionIR; flow: NodeIR[] }[];
      /** Default arm (the DSL's bare tail argument). Absent = fall through to the main line. */
      otherwise?: NodeIR[] | undefined;
    })
  | (NodeBaseIR & { type: 'filter'; condition: ConditionIR; reason?: string | undefined })
  | (NodeBaseIR & {
      type: 'cohort';
      /**
       * Explicit experiment key: bucketing hashes `userId:key` instead of the
       * structural node id, so the assignment survives node insertion/moves and
       * the experiment keeps one identity across workflow versions. Absent →
       * the node id is used (fine for one-off splits).
       */
      key?: string | undefined;
      /** Ordered array (the DSL object's insertion order); weights sum to 100. */
      arms: { name: string; weight: number; flow: NodeIR[] }[];
    })
  | (NodeBaseIR & { type: 'exit'; reason?: string | undefined })
  | (NodeBaseIR & { type: 'send_event'; event: string; payload: Record<string, PropValueIR> });

const nodeBase = { id: z.string(), label: z.optional(z.string()), meta: z.optional(NodeMetaIR) };

export const NodeIR: z.ZodMiniType<NodeIR> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      ...nodeBase,
      type: z.literal('message'),
      channel: ChannelIR,
      template: z.string(),
      props: z.record(z.string(), PropValueIR),
    }),
    z.object({ ...nodeBase, type: z.literal('delay'), duration: DurationIR }),
    z.object({ ...nodeBase, type: z.literal('random_delay'), min: DurationIR, max: DurationIR }),
    z.object({
      ...nodeBase,
      type: z.literal('time_window'),
      days: z.array(WeekdayIR),
      between: z.tuple([z.string(), z.string()]),
      tz: z.string(),
    }),
    z.object({
      ...nodeBase,
      type: z.literal('wait_until'),
      condition: ConditionIR,
      timeout: DurationIR,
      onTimeout: z.union([z.literal('continue'), z.literal('exit'), z.array(NodeIR)]),
    }),
    z.object({
      ...nodeBase,
      type: z.literal('branch'),
      cases: z.array(
        z.object({
          label: z.optional(z.string()),
          condition: ConditionIR,
          flow: z.array(NodeIR),
        })
      ),
      otherwise: z.optional(z.array(NodeIR)),
    }),
    z.object({
      ...nodeBase,
      type: z.literal('filter'),
      condition: ConditionIR,
      reason: z.optional(z.string()),
    }),
    z.object({
      ...nodeBase,
      type: z.literal('cohort'),
      key: z.optional(z.string()),
      arms: z.array(z.object({ name: z.string(), weight: z.number(), flow: z.array(NodeIR) })),
    }),
    z.object({ ...nodeBase, type: z.literal('exit'), reason: z.optional(z.string()) }),
    z.object({
      ...nodeBase,
      type: z.literal('send_event'),
      event: z.string(),
      payload: z.record(z.string(), PropValueIR),
    }),
  ])
);

/* ---------------------- Top-level definitions and bundle --------------------- */

export const GoalIR = z.object({
  condition: ConditionIR,
  within: z.optional(DurationIR),
  exitOnMatch: z.boolean(),
});
export type GoalIR = z.infer<typeof GoalIR>;

/**
 * Human-facing metadata: **excluded from contentHash** (see hash.ts).
 * Editing a description or tag does not touch execution semantics, so it never
 * invalidates the version in-flight users are pinned to, nor shows up in plan.
 */
export const MetaIR = z.object({
  description: z.optional(z.string()),
  tags: z.optional(z.array(z.string())),
  owner: z.optional(z.string()),
  loc: z.optional(SourceLocIR),
});
export type MetaIR = z.infer<typeof MetaIR>;

export const WorkflowIR = z.object({
  irVersion: z.literal(IR_VERSION),
  name: z.string(),
  contentHash: z.string(),
  meta: z.optional(MetaIR),
  trigger: TriggerIR,
  goal: z.optional(GoalIR),
  exitWhen: z.optional(ConditionIR),
  flow: z.array(NodeIR),
});
export type WorkflowIR = z.infer<typeof WorkflowIR>;

export const SegmentIR = z.object({
  irVersion: z.literal(IR_VERSION),
  name: z.string(),
  contentHash: z.string(),
  meta: z.optional(NodeMetaIR),
  condition: ConditionIR,
});
export type SegmentIR = z.infer<typeof SegmentIR>;

/** Template manifest entry: IR records only the reference; the body lives in the template system. */
export const TemplateIR = z.object({
  irVersion: z.literal(IR_VERSION),
  key: z.string(),
  channel: ChannelIR,
});
export type TemplateIR = z.infer<typeof TemplateIR>;

/**
 * Deployment unit: the complete snapshot one `deploy` produces (terraform
 * apply, same mental model). The server diffs each definition's contentHash to
 * decide publish / skip / retire.
 */
export const BundleIR = z.object({
  irVersion: z.literal(IR_VERSION),
  workflows: z.array(WorkflowIR),
  segments: z.array(SegmentIR),
  templates: z.array(TemplateIR),
});
export type BundleIR = z.infer<typeof BundleIR>;
