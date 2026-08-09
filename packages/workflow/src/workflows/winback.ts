import { eq, template, trigger, workflow } from '../dsl';
import { e, u } from '../schema';
import { purchaser } from '../segments';

/**
 * 取消订阅挽回（winback）。
 *
 * branch 形态走查：多臂 first-match 按套餐分层 + 臂内 .exit()（终止不合流）
 * + 裸尾参数默认分支 + 分支后的合流收尾（只有未 exit 的臂会到达）。
 */

/* --------------------------------- 模板 --------------------------------- */

/** 通知客户成功团队的内部 Slack 消息（消息渠道不只发给用户）。 */
const csAlert = template.slack<{ plan: 'free' | 'pro' | 'business' }>('cs_churn_alert');

const proWinback = template.email('winback_pro_offer');
const freeWinback = template.email('winback_free_tips');
const finalOffer = template.email<{ coupon: string; expiresIn: string }>('winback_final_offer');

/* -------------------------------- workflow -------------------------------- */

export const winback = workflow('winback', {
  trigger: trigger.event(e.subscription_cancelled),
  goal: purchaser, // 重新付费 = 转化，默认达成即退出
})
  .delay('1 day') // 冷静期，避免情绪期打扰
  .branch(
    'plan_split',
    // Business 客户：交给人工，流程到此为止——exit 不合流
    [
      eq(u.subscription_plan, 'business'),
      (w) => w.slack(csAlert, { plan: u.subscription_plan }).exit('handed_to_cs'),
    ],
    // Pro：自动化挽回优惠
    [eq(u.subscription_plan, 'pro'), (w) => w.email(proWinback)],
    // 其余（free 降级等）：内容营销
    (w) => w.email(freeWinback)
  )
  // 合流收尾：pro 和默认分支会到这里，business 已经 exit 不会
  .delay('7 days')
  .email(finalOffer, { coupon: 'COMEBACK20', expiresIn: '72 hours' });
