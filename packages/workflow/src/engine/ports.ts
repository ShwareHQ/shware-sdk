import type { ChannelIR, ConditionIR, ScalarIR } from '../ir';

/**
 * 引擎端口：解释器唯一依赖的外部世界形状。
 *
 * 设计约束（AWS-proof，见引擎设计记录）：
 * - waitForEvent 语义是"**至少一次唤醒 + 醒后重评估**"——唤醒只是提示，
 *   不承诺事件缓冲/去重（Cloudflare 有缓冲、AWS callback token 没有，
 *   端口取两者交集）；条件真值永远由调用方醒后重查。
 * - 一切非确定性（随机、当前时间、外部 IO）必须发生在 step.do 内，
 *   结果被持久化后 replay 才能对齐。
 */

export interface EngineStep {
  /** 持久化步骤：fn 的返回值被 checkpoint，replay 时跳过执行直接取结果。 */
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;

  /** 持久化睡眠：挂起不计费。 */
  sleep(name: string, ms: number): Promise<void>;

  /** 睡到绝对时刻（time_window 用）。 */
  sleepUntil(name: string, timestampMs: number): Promise<void>;

  /**
   * 等待外部唤醒或超时。events 是关心的事件名列表——适配器据此注册订阅
   * （Cloudflare：写订阅表 + waitForEvent；AWS：签发 callback token）。
   */
  waitForEvent(
    name: string,
    opts: { events: readonly string[]; timeoutMs: number }
  ): Promise<'event' | 'timeout'>;
}

/** 单用户视角的事实源：条件求值的读取接口（D1 / 内存实现同一份求值逻辑）。 */
export interface FactSource {
  /** 事件发生次数；sinceMs 给出则只数窗口内。 */
  countEvents(event: string, sinceMs?: number): Promise<number>;
  getProperty(path: string): Promise<ScalarIR | undefined>;
  /** 按名解析 segment 定义（部署时随 Bundle 落库）。 */
  getSegmentCondition(name: string): Promise<ConditionIR | undefined>;
}

export interface OutboundMessage {
  channel: ChannelIR;
  template: string;
  /** 已解析：user_property 引用被替换为实际值。 */
  props: Record<string, ScalarIR | undefined>;
  userId: string;
  /** `${instanceId}:${nodeId}`——发送方用它做去重（replay/重试安全）。 */
  idempotencyKey: string;
}

export interface MessageSender {
  send(message: OutboundMessage): Promise<void>;
}

/** send_event 的出口：回注入口（跨 workflow 组合的事件边）。 */
export interface EventSink {
  emit(event: string, payload: Record<string, ScalarIR | undefined>): Promise<void>;
}

export interface JourneyContext {
  userId: string;
  /** 实例标识：进入幂等键与日志。 */
  instanceId: string;
  step: EngineStep;
  facts: FactSource;
  messages: MessageSender;
  events: EventSink;
}

export type JourneyOutcome =
  | { status: 'completed' }
  | { status: 'exited'; reason?: string }
  | { status: 'goal' }
  | { status: 'exit_when' };
