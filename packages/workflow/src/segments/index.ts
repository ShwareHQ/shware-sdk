import { and, eq, performed, segment } from '../dsl';
import { e, u } from '../schema';

/**
 * Segment：命名的条件表达式（drizzle 风格：谓词 + 组合子 + 引用表）。
 * 类型从 u.xxx / e.xxx 引用流入：属性名、值、运算符适用性全部编译期检查。
 */

/** 活跃订阅者：subscription_status = 'active' 且 auto_renew_enabled = true。 */
export const activeSubscriber = segment(
  'active_subscriber',
  and(eq(u.subscription_status, 'active'), eq(u.auto_renew_enabled, true))
);

/** 已购买（30 天内）——checkout 挽回流程的 goal。 */
export const purchaser = segment('purchaser', performed(e.purchase, { within: '30 days' }));

/** 已激活：注册后创建过第一篇文档。 */
export const activated = segment('activated', performed(e.doc_created));

/** 新用户（7 天内注册）——onboarding 的入流门槛。 */
export const newUsers7d = segment('new_users_7d', performed(e.sign_up, { within: '7 days' }));

/* ---- 功能使用 segment：onboarding 教育系列的判定依据（customer.io 的 "Used X"） ---- */

export const usedTemplates = segment('used_templates', performed(e.template_used));
/** 协作 = 邀请过队友且发过评论，缺一不可。 */
export const usedCollaboration = segment(
  'used_collaboration',
  and(performed(e.teammate_invited), performed(e.comment_added))
);
export const usedWhiteboards = segment('used_whiteboards', performed(e.whiteboard_created));
export const usedIntegrations = segment('used_integrations', performed(e.integration_connected));
export const usedAutomations = segment('used_automations', performed(e.automation_created));
export const usedApi = segment('used_api', performed(e.api_key_created));
export const usedMobile = segment('used_mobile', performed(e.mobile_app_opened));
export const usedPublishing = segment('used_publishing', performed(e.doc_published));
