import {
  compileBundle,
  event,
  performed,
  segment,
  templates,
  trigger,
  user,
  workflow,
} from '../../../packages/workflow/src/dsl';
/**
 * 秒级时长的演示流程：本地 wrangler dev 里肉眼看完整链路
 * （事件 → 触发 → 睡眠 → 分支/等待 → 渲染发送 → goal 退出）。
 * 直连 workspace 源码（免 build）；真实项目 import '@shware/workflow'。
 */
import type { Emails } from '../emails';

type Empty = Record<never, never>;

interface DemoEvent {
  demo_signup: Empty;
  demo_click: Empty;
  demo_purchase: { value: number };
}

interface DemoUser {
  userId: string;
  email: string;
  plan: string;
}

const e = event<DemoEvent>();
export const u = user<DemoUser>();

/** key 由 emails registry 定类型；props 从组件签名推导（type-only import，无运行时依赖）。 */
const t = templates<Emails>();
const welcome = t.email('demo_welcome');
const offer = t.email('demo_offer');
// t.email('typo') ← 编译报错：key 不在 registry 里

const purchased = segment('demo_purchased', performed(e.demo_purchase));

/** 分支演示：注册 → 5s → 点过链接走 A、否则走 B；下单（goal）随时退出。 */
export const demoRecovery = workflow('demo_recovery', {
  trigger: trigger.event(e.demo_signup),
  goal: purchased,
})
  .email(welcome, { plan: u.plan })
  .delay('5 seconds')
  .branch(
    [
      performed(e.demo_click),
      (w) => w.email(offer, { coupon: 'CLICKED10', expiresIn: '24 hours' }),
    ],
    (w) => w.email(offer, { coupon: 'COMEBACK20', expiresIn: '48 hours' })
  );

/** wait_until 演示：等 demo_click 唤醒，20s 超时则继续。 */
export const demoWaiter = workflow('demo_waiter', {
  trigger: trigger.event(e.demo_signup),
})
  .waitUntil(performed(e.demo_click), { timeout: '20 seconds', onTimeout: 'continue' })
  .email(welcome, { plan: u.plan });

export function demoBundle() {
  return compileBundle({
    workflows: [demoRecovery, demoWaiter],
    segments: [purchased],
    templates: [welcome, offer],
  });
}
