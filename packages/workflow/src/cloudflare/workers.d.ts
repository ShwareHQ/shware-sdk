/**
 * cloudflare:workers 的最小 ambient 声明——只覆盖 JourneyRunner 用到的面。
 * 不引 @cloudflare/workers-types（全局类型与 react/DOM 冲突）；
 * 形状对齐官方 API：https://developers.cloudflare.com/workflows/build/workers-api/
 */
declare module 'cloudflare:workers' {
  export interface WorkflowEvent<Params = unknown> {
    payload: Readonly<Params>;
    timestamp: Date;
    instanceId: string;
  }

  export interface WorkflowStepEvent<Payload = unknown> {
    payload: Payload;
    timestamp: Date;
    type: string;
  }

  export interface WorkflowStep {
    do<T>(name: string, callback: () => Promise<T>): Promise<T>;
    sleep(name: string, durationMs: number | string): Promise<void>;
    sleepUntil(name: string, timestamp: Date | number): Promise<void>;
    waitForEvent<Payload = unknown>(
      name: string,
      options: { type: string; timeout?: number | string }
    ): Promise<WorkflowStepEvent<Payload>>;
  }

  export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    protected readonly env: Env;
    abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }
}
