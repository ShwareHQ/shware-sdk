import { not, performed, segment, template, trigger, workflow } from '../dsl';
import { e } from '../schema';

/**
 * 沉默用户召回（re-engagement）。
 *
 * 走查重点：segment 进入触发（非事件触发）+ waitUntil 等待回归 +
 * 臂内 exit 的单臂 branch + cohort A/B 验证优惠是否必要。
 */

/* ------------------------------ 触发与条件 ------------------------------ */

/** 30 天没登录——segment 进入触发：从"活跃"变为"沉默"的瞬间入流。 */
const inactive30d = segment('inactive_30d', not(performed(e.login, { within: '30 days' })));

/** 回来了 = 近 7 天登录过。 */
const cameBack = performed(e.login, { within: '7 days' });

/* --------------------------------- 模板 --------------------------------- */

const missYou = template.email('reengage_miss_you');
const highlights = template.email('reengage_product_highlights');
const incentive = template.email<{ coupon: string }>('reengage_incentive');

/* -------------------------------- workflow -------------------------------- */

export const reengagement = workflow('reengagement', {
  trigger: trigger.segment(inactive30d),
})
  .email(missYou)
  .waitUntil(cameBack, { timeout: '7 days', onTimeout: 'continue' }) // 最多等一周
  .branch([cameBack, (w) => w.exit('reengaged')]) // 已回归：结束；未回归：继续主线
  .email(highlights)
  .delay('7 days')
  .branch([
    not(cameBack),
    // 仍未回归才进入 A/B：对照组验证优惠券是否真的必要
    (w) =>
      w.cohort({
        control: { weight: 50 },
        coupon: { weight: 50, flow: (x) => x.email(incentive, { coupon: 'WELCOMEBACK15' }) },
      }),
  ]);
