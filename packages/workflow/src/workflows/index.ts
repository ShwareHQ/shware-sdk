import { contains, eq, exists, flow, gt, trigger, workflow } from '../dsl';
import { e, u } from '../schema';
import { activated, activeSubscriber, purchaser } from '../segments';
import {
  firstTimeRecovery,
  gettingStarted,
  limitedTimeOffer,
  proTips,
  upgradeRecovery,
} from '../templates';

/* ------------------------------ 触发器与条件 ------------------------------ */

/** 触发器资产：跨 workflow 复用；事件名从 e.xxx 引用取得，未来 payload 过滤挂这里。 */
const checkoutStarted = trigger.event(e.begin_checkout);
/** 入流门槛挂在 trigger 上（customer.io 的 trigger Filters）：注册且有邮箱才入流。 */
const signedUp = trigger.event(e.sign_up, { filter: exists(u.email) });
const christmasMorning = trigger.date('2026-12-25 09:00:00');

/** 匿名可复用条件 = 普通表达式常量：代码内复用，但不进 segment 侧边栏。 */
const powerUser = gt(u.docs_count, 100);

/* ------------------------------ 可复用流程片段 ------------------------------ */

/**
 * U1（升级弃购挽回）：一封邮件，无折扣，个性化引用用户当前计划。
 * 原图节点：U1: Upgrade recovery → Exit。
 */
const upgradeFlow = flow((w) => w.email(upgradeRecovery, { plan: u.subscription_plan }));

/**
 * N1/N2（首购弃购挽回）：无折扣提醒 → 23h → 限时折扣（折扣压到第二封，
 * 避免训练用户弃购拿折扣）。原图节点：N1 → Time Delay 23h → 分支 → N2。
 */
const firstTimeFlow = flow((w) =>
  w
    .email(firstTimeRecovery)
    .delay('23 hours')
    .email(limitedTimeOffer, { coupon: '15OFF', expiresIn: '48 hours' })
);

/**
 * 嵌套分支：when 的臂就是完整的 FlowBuilder，里面可以继续 .branch()。
 * 约定：超过一层的内层分支沉成命名片段（像这样），每个表达式保持浅。
 */
const subscriberSplit = flow((w) =>
  w.branch([powerUser, (w) => w.email(proTips)], (w) => w.email(gettingStarted))
);

/* -------------------------------- workflows -------------------------------- */

/**
 * Checkout 挽回 —— customer.io 原图的完整复刻：
 *
 *   Trigger: begin_checkout
 *   ├─ Wait 1 hour
 *   ├─ 已购买？ ──── True → Exit          ┐
 *   ├─ 订阅者？                            │ 三处 True→Exit 分支全部由
 *   │   ├─ True  → U1 升级挽回 → Exit      │ goal 吸收（购买=转化，
 *   │   └─ False → N1 首购挽回             │ 默认达成即退出，并进报表）
 *   │              ├─ Wait 23 hours        │
 *   │              ├─ 已购买？ True → Exit ┘
 *   │              └─ N2 限时折扣 → Exit
 *
 * 原图 12 个节点（含 5 个 Exit、3 个条件分支）→ 下面 3 步。
 */
export const checkoutRecovery = workflow('checkout_recovery', {
  trigger: checkoutStarted,
  goal: purchaser,
  // 以下元数据不参与 contentHash：改文案不影响在途用户、plan 也不报变更
  description: '弃购 1 小时后按订阅状态分流挽回：订阅者讲价值，首购者给折扣',
  tags: ['revenue', 'lifecycle'],
  owner: 'growth@example.com',
})
  .delay('1 hour')
  .branch(
    'subscriber_split', // label：UI 节点名 / 观测定位，非跳转目标
    [activeSubscriber, upgradeFlow],
    firstTimeFlow // 裸尾参数 = 默认分支
  );

/**
 * Onboarding：其余原语走查——waitUntil / timeWindow / 多臂 branch / cohort，
 * 以及内联条件（不必先命名 segment，when/filter 里直接定义）。
 */
export const onboarding = workflow('onboarding', { trigger: signedUp })
  .waitUntil(activated, { timeout: '3 days', onTimeout: 'continue' })
  .timeWindow({
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    between: ['09:00', '17:00'],
    tz: 'user',
  })
  .branch(
    [activeSubscriber, subscriberSplit], // 臂内嵌套分支：沉成片段保持浅
    (w) => w.email(gettingStarted)
  )
  .cohort({
    control: { weight: 50 },
    variant: { weight: 50, flow: (w) => w.delay('3 days').email(proTips) },
  });

/** 定时触发示例：圣诞促销，只发给活跃订阅者。segment/webhook 触发同理。 */
export const christmasPromo = workflow('christmas_promo', { trigger: christmasMorning })
  .filter(activeSubscriber)
  .email(limitedTimeOffer, { coupon: 'XMAS25', expiresIn: '72 hours' });

/**
 * 周期提醒：树内没有循环——结尾 sendEvent 自触发是"循环"的正确形态
 * （跨 workflow 事件边；goal 保证终止并计转化，触发频率上限兜底）。
 * goal 完整形态：归因窗口 30 天，达成即退出（缺省行为，写出来作演示）。
 */
export const activationNudge = workflow('activation_nudge', {
  trigger: trigger.event(e.activation_nudge_due),
  goal: { condition: activated, within: '30 days', exitOnMatch: true },
})
  .email(gettingStarted)
  .delay('7 days')
  .sendEvent(e.activation_nudge_due);

/* ------------------------- 类型安全走查（编译期报错示例） ------------------------- */
/* tsc 会校验以下注释确实各压制了一个错误（若未报错则 @ts-expect-error 本身报错）。 */
/* 包在永不调用的函数里：这些是类型层断言，运行时不能执行（部分会真抛错）。 */

const _typeChecks = () => {
  // @ts-expect-error trigger 必须是 trigger.xxx() 资产（字符串速记已随 E 泛型一起移除）
  workflow('bad_trigger', { trigger: 'sign_up' });

  // @ts-expect-error trigger.event 只接受引用表里存在的事件（属性访问检查）
  trigger.event(e.no_such_event);

  // @ts-expect-error contains 只收 string 引用（docs_count 是 number）——运算符收窄由谓词签名表达
  contains(u.docs_count, '1');

  // @ts-expect-error 谓词的值类型从引用流入（subscription_status 没有 'archived'）
  eq(u.subscription_status, 'archived');

  // @ts-expect-error 引用表只有 schema 里声明的属性
  exists(u.no_such_property);

  // @ts-expect-error props 值超出模板声明的类型（plan 只能是 free/pro/max）
  flow((w) => w.email(upgradeRecovery, { plan: 'enterprise' }));

  // @ts-expect-error 模板声明了必填 props，缺失报错
  flow((w) => w.email(upgradeRecovery));

  // @ts-expect-error 引用的用户属性类型与 props 声明不匹配（email: string ≠ plan 枚举）
  flow((w) => w.email(upgradeRecovery, { plan: u.email }));

  // @ts-expect-error 时长拼写错误
  flow((w) => w.delay('1 huor'));

  // @ts-expect-error sendEvent 只接受引用表里存在的事件
  flow((w) => w.sendEvent(e.no_such_event));

  // @ts-expect-error sendEvent payload 类型校验（value 必须是 number）
  flow((w) => w.sendEvent(e.purchase, { value: 'high', currency: 'USD' }));
};
void _typeChecks;
