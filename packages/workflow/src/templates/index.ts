import { template } from '../dsl';
import type { UserProperty } from '../schema';

/**
 * 消息模板：顶层命名资产。props 形状在此声明，使用处类型检查。
 * key 对应模板系统里的内容（liquid/react-email 等，后续课题）。
 */

/** U1（T+1h，升级弃购）：单封邮件，无折扣，讲清高阶计划解锁什么。 */
export const upgradeRecovery = template.email<{
  plan: UserProperty['subscription_plan'];
}>('u1_upgrade_recovery');

/** N1（T+1h，首购弃购）：无折扣，低摩擦提醒 + 打消顾虑。 */
export const firstTimeRecovery = template.email('n1_first_time_recovery');

/** N2（T+24h，仅首购）：终章，15% 折扣码，48h 过期。 */
export const limitedTimeOffer = template.email<{
  coupon: string;
  expiresIn: string;
}>('n2_limited_time_offer');

/** Onboarding：新手引导。 */
export const gettingStarted = template.email('onboarding_getting_started');

/** Onboarding：进阶技巧（活跃用户版）。 */
export const proTips = template.email('onboarding_pro_tips');
