/**
 * Workflow DSL 表面定义 —— 仅类型表达，无运行时实现。
 *
 * 设计原则：
 * 1. 全声明式：链式调用与条件表达式构造的是可序列化的图（IR），不是运行时
 *    代码。子流程回调只在构造期执行一次（builder 进、builder 出），运行时值
 *    一律是数据引用（UserPropertyRef），不允许闭包。
 * 2. drizzle 式类型策略：泛型只存在于两个引用表上（`u = user<UserProperty>()`、
 *    `e = event<Event>()`——仅有的类型注入点），其余全部是零泛型的自由
 *    函数/对象（谓词 eq/gt/…、组合子 and/or/not、segment/template/trigger/
 *    flow/workflow），类型从引用的幻影类型流入。没有中心 factory。
 * 3. 三层结构：引用表（u / e）→ 可复用资产（template / segment / trigger）
 *    → 流程原语（workflow + FlowBuilder 链）+ 条件表达式（谓词组合）。
 * 4. options = 配置（trigger / goal / exitWhen），链 = 纯步骤。
 */

/* ---------------------------------- 基础 ---------------------------------- */

/**
 * 事件名 → payload 形状。由业务侧（analytics 埋点 schema）提供。
 * 约束用 object 而非 Record：interface 没有隐式索引签名，Record 约束会拒绝
 * interface 定义的 schema；事件名靠 keyof E 取，payload 靠 E[N] 取。
 */
export type EventMap = object;

/** 用户属性基础形状，业务侧扩展具体字段。 */
export interface UserPropertyBase {
  userId: string;
  email: string;
}

/** 时长字面量：'1 hour' / '23 hours' / '30 days'，拼写错误编译期报错。 */
export type Duration = `${number} ${
  | 'second'
  | 'seconds'
  | 'minute'
  | 'minutes'
  | 'hour'
  | 'hours'
  | 'day'
  | 'days'
  | 'week'
  | 'weeks'}`;

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** 'HH:mm'。TODO: 运行时校验格式，模板字面量类型对前导零表达力不足。 */
export type TimeOfDay = `${string}:${string}`;

/* ------------------------------ 引用（类型载体） ------------------------------ */

/**
 * 用户属性引用（drizzle 的 column 对应物）：谓词（eq/gt/…）与消息 props
 * 个性化共用。幻影类型 __t 让自由函数从引用上取到属性类型。
 */
export interface UserPropertyRef<T> {
  readonly kind: 'user_property';
  readonly path: string;
  readonly __t?: T;
}

/** 事件引用：performed 谓词的实参；未来 payload where 子句、payload 取值挂这里。 */
export interface EventRef<P = unknown> {
  readonly kind: 'event_ref';
  readonly name: string;
  readonly __p?: P;
}

/** 属性引用表：u.subscription_status 即 UserPropertyRef（drizzle 的 users.email）。 */
export type UserRefs<U> = { readonly [K in keyof U]-?: UserPropertyRef<U[K]> };

/** 事件引用表：e.purchase 即 EventRef。 */
export type EventRefs<E> = { readonly [K in keyof E]-?: EventRef<E[K]> };

/**
 * 引用表构造：业务侧在 schema 处各调一次并导出（运行时实现为 Proxy）。
 *
 *   export const u = user<UserProperties>();
 *   export const e = event<Events>();
 *
 * 之后谓词与个性化全部走属性访问：eq(u.subscription_status, 'active')、
 * performed(e.purchase, { within: '30 days' })、{ plan: u.subscription_plan }。
 * TODO: 嵌套属性路径（u.address.city）。
 */
export declare function user<U extends UserPropertyBase>(): UserRefs<U>;
export declare function event<E extends EventMap>(): EventRefs<E>;

export type PropInput<T> = T | UserPropertyRef<T>;
export type PropsInput<P> = { [K in keyof P]: PropInput<P[K]> };

/** 模板未声明 props 时可省略实参；声明了则必填。 */
export type MessageArgs<P> =
  Record<never, never> extends P ? [props?: PropsInput<P>] : [props: PropsInput<P>];

/* ---------------------------------- 模板 ---------------------------------- */

export type Channel = 'email' | 'sms' | 'push' | 'in_app' | 'slack' | 'survey';

export type EmptyProps = Record<never, never>;

/**
 * 模板引用：顶层命名资产，跨 workflow 复用、单独版本化。
 * props 形状在声明处指定，使用处类型检查。
 */
export interface TemplateRef<C extends Channel = Channel, P extends object = EmptyProps> {
  readonly channel: C;
  readonly key: string;
  readonly __props?: P;
}

/**
 * 模板内容：接收 props 的组件（react-email 等）。传组件而非 JSX 元素——
 * 组件形式让 P 从组件的 props 签名推导，模板 key、内容、使用处三方对齐。
 * 内容系统（渲染、liquid 兼容、多语言）是独立课题，先占位类型。
 */
export type TemplateContent<P extends object> = (props: P) => unknown;

export interface TemplateFactory {
  email<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'email', P>;
  sms<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'sms', P>;
  push<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'push', P>;
  inApp<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'in_app', P>;
  slack<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'slack', P>;
  survey<P extends object = EmptyProps>(
    key: string,
    content?: TemplateContent<P>
  ): TemplateRef<'survey', P>;
}

/**
 * 模板定义：自由对象，不依赖 f——模板的类型（props 形状）在声明处自足。
 *
 *   const welcome = template.email('onboarding_welcome');
 *   const offer = template.email('n2_offer', OfferEmail);   // P 从组件 props 推导
 */
export declare const template: TemplateFactory;

/* ------------------------------ 条件（表达式） ------------------------------ */

/** 不透明条件句柄：谓词、组合子、segment 的产物都是它。 */
export interface Condition {
  readonly __condition: true;
}

/*
 * 属性谓词：自由函数（drizzle 的 eq/gt/inArray 同款风格），类型从
 * UserPropertyRef 的幻影类型流入——运算符对属性类型的收窄由签名约束表达：
 * gt/lt/between 只收 string|number 引用，contains 只收 string 引用，
 * boolean 属性传给 gt 直接编译报错。对齐 customer.io 条件面板。
 * TODO: JSON array 'where at least one'、JSON object 'has the property'。
 */
/* 值参数一律 NoInfer：类型只从引用流入，杜绝 eq(ref, 'typo') 把错值并进 T 的推导陷阱。 */
export declare function eq<T>(ref: UserPropertyRef<T>, value: NoInfer<T>): Condition;
export declare function ne<T>(ref: UserPropertyRef<T>, value: NoInfer<T>): Condition;
export declare function gt<T extends string | number>(
  ref: UserPropertyRef<T>,
  value: NoInfer<T>
): Condition;
export declare function lt<T extends string | number>(
  ref: UserPropertyRef<T>,
  value: NoInfer<T>
): Condition;
export declare function between<T extends string | number>(
  ref: UserPropertyRef<T>,
  min: NoInfer<T>,
  max: NoInfer<T>
): Condition;
export declare function inArray<T>(
  ref: UserPropertyRef<T>,
  values: readonly NoInfer<T>[]
): Condition;
export declare function notInArray<T>(
  ref: UserPropertyRef<T>,
  values: readonly NoInfer<T>[]
): Condition;
export declare function exists(ref: UserPropertyRef<unknown>): Condition;
export declare function notExists(ref: UserPropertyRef<unknown>): Condition;
export declare function contains<T extends string>(
  ref: UserPropertyRef<T>,
  value: string
): Condition;
export declare function notContains<T extends string>(
  ref: UserPropertyRef<T>,
  value: string
): Condition;

/**
 * 事件谓词：做过某事件（可限时间窗口与次数）。
 * "没做过" = not(performed(...))，组合子表达，不设 notPerformed。
 */
export declare function performed(
  event: EventRef,
  opts?: { within?: Duration; count?: number }
): Condition;

/** 条件组合子：任意嵌套。 */
export declare function and(...conditions: readonly Condition[]): Condition;
export declare function or(...conditions: readonly Condition[]): Condition;
export declare function not(condition: Condition): Condition;

/**
 * Segment：命名的条件表达式，顶层资产——进 UI 侧边栏、跨 workflow 复用、
 * IR 里按名引用、成员数持续物化可观测（segment 触发的前提）。
 * 匿名复用 = 普通 const 表达式；一次性判断 = 使用处内联表达式。
 * TODO 规则种类补齐（对齐 customer.io 面板）：form / page / device / screen /
 * opt-out / message data（email opened、sms clicked、webhook …）
 */
export interface SegmentRef extends Condition {
  readonly __segment: true;
  readonly name: string;
}

/**
 * Segment 定义：自由函数，不依赖 f——条件表达式的类型在谓词处已经检查完毕。
 *
 *   export const purchaser = segment('purchaser', performed(e.purchase, { within: '30 days' }));
 */
export declare function segment(name: string, condition: Condition): SegmentRef;

/* ---------------------------------- 流程 ---------------------------------- */

/** 可复用流程片段（flow(...) 的产物），branch 臂等处直接引用。 */
export interface Flow {
  readonly __flow: true;
}

/** 子流程：命名片段，或内联回调（仅构造期执行一次，builder 进 builder 出）。 */
export type SubFlow = Flow | ((w: FlowBuilder) => FlowBuilder);

/** branch 分支臂：[条件, 子流程] 二元组（[if, then] 的排列约定）。 */
export type BranchCase = readonly [condition: Condition, flow: SubFlow];

/**
 * branch 的实参：二元组分支臂，或裸子流程 = 默认分支（otherwise）。
 * 裸子流程只能出现一次且必须在最后（运行时校验）。
 */
export type BranchArm = BranchCase | SubFlow;

export interface FlowBuilder {
  /* ------ Messages（六渠道底层同为 message 节点，分方法以获得渠道级类型约束） ------ */
  email<P extends object>(template: TemplateRef<'email', P>, ...props: MessageArgs<P>): this;
  sms<P extends object>(template: TemplateRef<'sms', P>, ...props: MessageArgs<P>): this;
  push<P extends object>(template: TemplateRef<'push', P>, ...props: MessageArgs<P>): this;
  inApp<P extends object>(template: TemplateRef<'in_app', P>, ...props: MessageArgs<P>): this;
  slack<P extends object>(template: TemplateRef<'slack', P>, ...props: MessageArgs<P>): this;
  survey<P extends object>(template: TemplateRef<'survey', P>, ...props: MessageArgs<P>): this;

  /* --------------------------------- Delays --------------------------------- */
  /** Time Delay；传 { min, max } 即 Randomized Delay。 */
  delay(duration: Duration): this;
  delay(range: { min: Duration; max: Duration }): this;

  /** Time Window：暂停直到进入窗口（如工作日 09:00–17:00）。tz: 'user' 用用户时区。 */
  timeWindow(opts: {
    days?: readonly Weekday[];
    between: readonly [TimeOfDay, TimeOfDay];
    tz?: 'user' | (string & {});
  }): this;

  /**
   * Wait Until：条件满足走主线，超时走 onTimeout（默认 'continue'）。
   * 引擎侧对应"事件等待 + 定时器竞速"，durable runtime 的原生原语。
   */
  waitUntil(
    condition: Condition,
    opts: { timeout: Duration; onTimeout?: 'continue' | 'exit' | SubFlow }
  ): this;

  /* ------------------------------ Flow Control ------------------------------ */
  /**
   * 条件分支：有序 first-match（Step Functions Choice / Knock branch 同款语义）。
   * 一个原语覆盖 UI 的 True/False Branch（两臂）和 Multi-Split Branch（N 臂）。
   * 分支臂是 [条件, 子流程] 二元组；裸子流程尾参数 = 默认分支（otherwise）。
   * 无命中且无默认分支时直接继续主线。结构化合流语义：命中臂执行完继续
   * branch 之后的节点，不想合流在臂内显式 .exit()。
   *
   *   .branch([activeSubscriber, upgradeFlow], firstTimeFlow)   // True/False
   *   .branch([vip, vipFlow], [trial, trialFlow], defaultFlow)  // Multi-Split
   *   .branch([not(usedWhiteboards), eduFlow])                  // 单臂：未命中继续主线
   *
   * 可选首参 label：进 IR 作节点名（UI 标题 / 观测定位），不构成跳转目标——
   * 不提供 goto 语义；周期性/循环需求用 sendEvent 自触发（见 sendEvent）。
   * UI 分支标签从条件（segment 名）自动派生。
   */
  branch(...arms: readonly BranchArm[]): this;
  branch(label: string, ...arms: readonly BranchArm[]): this;

  /**
   * 门（gate）：条件不满足即退出，满足则继续。一等节点，不是 branch 糖——
   * Zapier "only continue if" / Iterable Filter tile 的同款语义，UI 单独渲染。
   */
  filter(condition: Condition, opts?: { reason?: string }): this;

  /** Random Cohort Branch（A/B）：weight 总和须为 100（运行时校验）。 */
  cohort(arms: Record<string, { weight: number; flow?: SubFlow }>): this;

  /**
   * Exit：立即结束整个 workflow（对应 UI 的 Exit 节点），reason 进审计日志。
   * 在 branch 臂内使用即"终止不合流"——臂走到 exit 就结束，不再汇入
   * branch 之后的主线；不写 exit 的臂执行完自然合流。
   */
  exit(reason?: string): this;

  /* ---------------------------------- Data ---------------------------------- */
  /**
   * 发出类型化事件（customer.io 的 Send Event 同款）。事件从 e.xxx 引用取得
   * （payload 类型随引用流入，与 trigger.event 同机制）。跨 workflow 组合：
   * 事件可触发其他 workflow，调用图可静态分析；也是"循环"的官方形态——
   * workflow 内部保持树，结尾 sendEvent 自触发 + goal + 触发频率上限实现
   * 周期流程。payload 值可用 u.xxx 引用。
   * TODO: Data 品类其余步骤——webhook 出站 / 更新 profile / journey attributes。
   */
  sendEvent<P extends object>(event: EventRef<P>, ...payload: MessageArgs<P>): this;
}

/* --------------------------------- trigger --------------------------------- */

/** 'YYYY-MM-DD HH:mm:ss'。TODO: 运行时校验；模板字面量类型对前导零表达力不足。 */
export type DateTime = string;

/** 触发器引用：trigger.xxx() 的产物，可跨 workflow 复用。 */
export interface TriggerRef {
  readonly kind: 'event' | 'segment' | 'date' | 'webhook';
}

/** 触发器工厂：四种入流方式，对齐 customer.io 的 campaign trigger 类型。 */
export interface TriggerFactory {
  /**
   * 事件触发：事件名来自 e.xxx 引用（类型随引用流入，工厂本身零泛型）。
   * filter = 入流门槛（对 profile 的条件，customer.io 的 trigger Filters）：
   * 事件发生且满足 filter 才入流。TODO: payload 过滤（where 子句，P 为此保留）。
   */
  event<P>(event: EventRef<P>, opts?: { filter?: Condition }): TriggerRef;

  /**
   * segment 进入触发：用户从"不满足"变为"满足"的瞬间入流。
   * 只接受命名 segment——进入语义要求持续物化的成员表，匿名表达式给不了。
   */
  segment(segment: SegmentRef): TriggerRef;

  /** 定时触发（一次性，如 '2026-12-25 09:00:00' 圣诞营销）。TODO: cron 周期。 */
  date(at: DateTime): TriggerRef;

  /** webhook 触发：第三方或外部代码经 URL 触发，运行时分配端点。 */
  webhook(): TriggerRef;
}

/**
 * 触发器定义：自由对象，不依赖 f——事件名从 e.xxx 引用取得。
 *
 *   const login = trigger.event(e.login, { filter: newUsers7d });
 */
export declare const trigger: TriggerFactory;

/* --------------------------------- workflow --------------------------------- */

/** 转化目标的完整配置（customer.io 的 Goal & Exit 同款语义）。 */
export interface GoalOptions {
  condition: Condition;
  /** 转化归因窗口：入流后多久内达成才计入转化。缺省不限。 */
  within?: Duration;
  /** 达成即退出（exit on conversion）。缺省 true——吸收 UI 图里大量 True→Exit 分支。 */
  exitOnMatch?: boolean;
}

export interface WorkflowOptions {
  /** 触发器：trigger.xxx() 资产。TODO: 多 trigger、入流频率/re-entry 策略。 */
  trigger: TriggerRef;

  /**
   * 转化目标：进报表（转化率/归因），且默认达成即退出。
   * 每个节点执行前检查。速记形态直接传条件，完整形态用 GoalOptions。
   */
  goal?: Condition | GoalOptions;

  /** 纯退出条件：不计转化的离场（取关、失去资格等）。与 goal 可并存。 */
  exitWhen?: Condition;
}

/** 编译产物：可序列化 JSON 图。形状是下一步的设计课题。 */
export interface WorkflowIR {
  readonly __ir: 'workflow';
}

export interface WorkflowBuilder extends FlowBuilder {
  toIR(): WorkflowIR;
}

/* -------------------------------- 顶层构造器 -------------------------------- */

/**
 * 可复用流程片段：自由函数——个性化走 u.xxx、事件走 e.xxx 之后，
 * 流程层不再携带任何 schema 泛型。
 */
export declare function flow(build: (w: FlowBuilder) => FlowBuilder): Flow;

/** Workflow 定义：名字 + 配置（trigger / goal / exitWhen）+ 链式步骤。 */
export declare function workflow(name: string, options: WorkflowOptions): WorkflowBuilder;
