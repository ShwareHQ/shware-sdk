/**
 * Cloudflare 绑定的结构化最小接口。
 *
 * 刻意不依赖 @cloudflare/workers-types：它注入全局类型会与本包 react 侧的
 * DOM lib 冲突；结构化子集 + cloudflare:workers 的 ambient 声明足够编译，
 * 运行时由真实绑定满足（结构兼容）。
 */

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}

export interface WorkflowInstanceLike {
  id: string;
  sendEvent(event: { type: string; payload?: unknown }): Promise<void>;
}

export interface WorkflowBindingLike {
  create(options: { id: string; params: unknown }): Promise<WorkflowInstanceLike>;
  get(id: string): Promise<WorkflowInstanceLike>;
}

/** Journey 引擎需要的全部绑定（wrangler 配置对应命名）。 */
export interface JourneyEnv {
  /** BundleIR 存储：`wf:${contentHash}` → WorkflowIR JSON。 */
  WORKFLOW_KV: KVNamespaceLike;
  /** events / profiles / segments / triggers / entries / subscriptions。 */
  DB: D1DatabaseLike;
  /** JourneyRunner 的 workflow 绑定（创建实例 / 唤醒）。 */
  JOURNEY: WorkflowBindingLike;
  /** 可选：消息出口 webhook（缺省 console 日志发送器）。 */
  MESSAGE_WEBHOOK_URL?: string;
}

/** Router 唤醒等待中实例所用的事件类型（sendEvent 的 type）。 */
export const WAKE_EVENT_TYPE = 'wake';

/** 旅程实例参数：Ingest Router 创建实例时传入。 */
export interface JourneyParams {
  workflowName: string;
  /** 入流时 pin 的 IR 版本。 */
  contentHash: string;
  userId: string;
  trigger: { event: string; payload: Record<string, unknown> };
  [key: string]: unknown;
}
