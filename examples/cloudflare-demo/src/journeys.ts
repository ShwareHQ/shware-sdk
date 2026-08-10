/**
 * 秒级时长的演示流程：本地 wrangler dev 里肉眼看完整链路
 * （事件 → 触发 → 睡眠 → 分支/等待 → 发送 → goal 退出）。
 * 直连 workspace 源码（免 build）；真实项目 import '@shware/workflow'。
 */
import {
  compileBundle,
  event,
  performed,
  segment,
  template,
  trigger,
  user,
  workflow,
} from '../../../packages/workflow/src/dsl';

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

const purchased = segment('demo_purchased', performed(e.demo_purchase));

const welcome = template.email('demo_welcome');
const clickedFollowup = template.email('demo_clicked_followup');
const nudge = template.email('demo_nudge');
const waitDone = template.email('demo_wait_done');

/** 分支演示：注册 → 5s → 点过链接走 A、否则走 B；下单（goal）随时退出。 */
export const demoRecovery = workflow('demo_recovery', {
  trigger: trigger.event(e.demo_signup),
  goal: purchased,
})
  .email(welcome)
  .delay('5 seconds')
  .branch([performed(e.demo_click), (w) => w.email(clickedFollowup)], (w) => w.email(nudge));

/** wait_until 演示：等 demo_click 唤醒，20s 超时则继续。 */
export const demoWaiter = workflow('demo_waiter', {
  trigger: trigger.event(e.demo_signup),
})
  .waitUntil(performed(e.demo_click), { timeout: '20 seconds', onTimeout: 'continue' })
  .email(waitDone);

export function demoBundle() {
  return compileBundle({
    workflows: [demoRecovery, demoWaiter],
    segments: [purchased],
    templates: [welcome, clickedFollowup, nudge, waitDone],
  });
}
