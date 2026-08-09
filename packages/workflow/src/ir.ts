import * as z from 'zod/mini';

/**
 * IR（Intermediate Representation）—— DSL 的编译产物，可序列化 JSON。
 * 引擎解释执行、UI（react-flow）渲染、diff / 审计的三方合同。
 *
 * 校验策略：zod/mini schema 是 IR 的权威定义，TS 类型从 schema 推导或与
 * schema 同名手写（递归类型 zod 推导不了，手写后用 ZodMiniType<T> 注解锚定，
 * 两者漂移会编译报错）。IR 跨越进程边界（数据库、网络、UI），运行时校验必需。
 *
 * ## 版本化（两条独立的轴）
 *
 * 1. IR 格式版本（irVersion）：IR schema 自身的演进。加可选字段不升版本；
 *    结构不兼容（改判别值、删字段、改语义）才递增。读取方按 irVersion 分发
 *    到对应版本的 schema/迁移器；写入方永远写当前版本。
 * 2. 内容版本（contentHash）：单个定义的内容寻址标识——canonical JSON
 *    （键序稳定、无空白、不含 contentHash 自身）的 SHA-256 截断。用途：
 *    - 用户入流时 pin 住 contentHash，在途旅程按 pin 的版本执行到结束
 *      （默认策略；结构兼容的热更新是未来的显式迁移课题）；
 *    - 部署时 diff：hash 相同 = 定义未变，跳过发布；
 *    - 审计：任何时刻能回答"这个用户当时走的是哪个版本"。
 *
 * ## 节点 id
 *
 * 编译期按结构路径派生，稳定且确定：根层 '0'、'1'…；branch 第 i 个 case 的
 * 第 j 个子节点 '{branchId}.c{i}.{j}'，默认分支 '{branchId}.o.{j}'；cohort 臂
 * 用臂名 '{cohortId}.{armName}.{j}'；waitUntil 超时子流程 '{id}.t.{j}'。
 * 改节点参数不动 id；插入节点会移动后续兄弟的 id（已知取舍——在途用户定位
 * 依赖 pin 版本而非跨版本 id 对齐，跨版本迁移映射是显式迁移器的职责）。
 */

export const IR_VERSION = 1;

/* --------------------------------- 基础值 --------------------------------- */

export const ScalarIR = z.union([z.string(), z.number(), z.boolean()]);
export type ScalarIR = z.infer<typeof ScalarIR>;

/** 时长：value 保留 DSL 原文（'23 hours'，给 UI 展示），ms 是引擎用的毫秒数。 */
export const DurationIR = z.object({ value: z.string(), ms: z.number() });
export type DurationIR = z.infer<typeof DurationIR>;

/** 用户属性引用——与 DSL 的 UserPropertyRef 序列化后同构（幻影类型剥离）。 */
export const UserPropertyRefIR = z.object({
  type: z.literal('user_property'),
  path: z.string(),
});
export type UserPropertyRefIR = z.infer<typeof UserPropertyRefIR>;

/** 消息 props / 事件 payload 的值：字面量或用户属性引用。 */
export const PropValueIR = z.union([ScalarIR, UserPropertyRefIR]);
export type PropValueIR = z.infer<typeof PropValueIR>;

export const ChannelIR = z.enum(['email', 'sms', 'push', 'in_app', 'slack', 'survey']);
export type ChannelIR = z.infer<typeof ChannelIR>;

export const WeekdayIR = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type WeekdayIR = z.infer<typeof WeekdayIR>;

/* ---------------------------------- 条件 ---------------------------------- */

export const PropertyOperatorIR = z.enum([
  'eq',
  'ne',
  'gt',
  'lt',
  'between',
  'in_array',
  'not_in_array',
  'exists',
  'not_exists',
  'contains',
  'not_contains',
]);
export type PropertyOperatorIR = z.infer<typeof PropertyOperatorIR>;

/**
 * 条件表达式树。value/values 的形状随 op 变化：
 * eq/ne/gt/lt/contains/not_contains → value；in_array/not_in_array → values；
 * between → values = [min, max]；exists/not_exists → 两者皆无。
 * TODO: 按 op 收窄的运行时 refine。
 */
export type ConditionIR =
  | { type: 'and'; conditions: ConditionIR[] }
  | { type: 'or'; conditions: ConditionIR[] }
  | { type: 'not'; condition: ConditionIR }
  /** 按名引用命名 segment（定义在 SegmentIR，独立版本化）。 */
  | { type: 'segment'; segment: string }
  | {
      type: 'property';
      path: string;
      op: PropertyOperatorIR;
      value?: ScalarIR | undefined;
      values?: ScalarIR[] | undefined;
    }
  | {
      type: 'performed';
      event: string;
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
      type: z.literal('performed'),
      event: z.string(),
      within: z.optional(DurationIR),
      count: z.optional(z.number()),
    }),
  ])
);

/* ---------------------------------- 触发 ---------------------------------- */

export const TriggerIR = z.discriminatedUnion('type', [
  z.object({ type: z.literal('event'), event: z.string(), filter: z.optional(ConditionIR) }),
  z.object({ type: z.literal('segment'), segment: z.string() }),
  z.object({ type: z.literal('date'), at: z.string() }),
  z.object({ type: z.literal('webhook') }),
]);
export type TriggerIR = z.infer<typeof TriggerIR>;

/* ---------------------------------- 节点 ---------------------------------- */

interface NodeBaseIR {
  /** 结构路径派生的稳定 id（规则见文件头）。 */
  id: string;
  /** 可选节点名：UI 标题 / 观测定位（branch 的可选首参 label 落在这里）。 */
  label?: string | undefined;
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
      /** 默认分支（DSL 的裸尾参数）。缺省 = 未命中直接继续主线。 */
      otherwise?: NodeIR[] | undefined;
    })
  | (NodeBaseIR & { type: 'filter'; condition: ConditionIR; reason?: string | undefined })
  | (NodeBaseIR & {
      type: 'cohort';
      /** 有序数组（DSL 对象的插入序），weight 总和 = 100。 */
      arms: { name: string; weight: number; flow: NodeIR[] }[];
    })
  | (NodeBaseIR & { type: 'exit'; reason?: string | undefined })
  | (NodeBaseIR & { type: 'send_event'; event: string; payload: Record<string, PropValueIR> });

const nodeBase = { id: z.string(), label: z.optional(z.string()) };

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

/* ------------------------------ 顶层定义与部署单元 ------------------------------ */

export const GoalIR = z.object({
  condition: ConditionIR,
  within: z.optional(DurationIR),
  exitOnMatch: z.boolean(),
});
export type GoalIR = z.infer<typeof GoalIR>;

export const WorkflowIR = z.object({
  irVersion: z.literal(IR_VERSION),
  name: z.string(),
  contentHash: z.string(),
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
  condition: ConditionIR,
});
export type SegmentIR = z.infer<typeof SegmentIR>;

/** 模板清单项：IR 只记录引用与 props 形状约定，内容体在模板系统（独立课题）。 */
export const TemplateIR = z.object({
  irVersion: z.literal(IR_VERSION),
  key: z.string(),
  channel: ChannelIR,
});
export type TemplateIR = z.infer<typeof TemplateIR>;

/**
 * 部署单元：一次 `deploy`（terraform apply 同款心智）产出的完整快照。
 * 服务端 diff 各定义的 contentHash 决定发布/跳过/下线。
 */
export const BundleIR = z.object({
  irVersion: z.literal(IR_VERSION),
  workflows: z.array(WorkflowIR),
  segments: z.array(SegmentIR),
  templates: z.array(TemplateIR),
});
export type BundleIR = z.infer<typeof BundleIR>;
