import { event, user } from './dsl';

/**
 * 业务侧 schema：事件与用户属性的类型定义。
 * 最终形态应从 analytics 埋点 schema 生成/导入，这里先手写示例。
 * 示例产品：团队协作文档工作区（Notion/Linear 一类的 SaaS）。
 */

type Empty = Record<never, never>;

export interface Event {
  login: Empty;
  sign_up: { method: 'google' | 'apple' | 'email' };
  begin_checkout: { plan: 'pro' | 'business'; seats: number };
  purchase: { value: number; currency: string };
  subscription_cancelled: { reason: 'too_expensive' | 'not_useful' | 'missing_features' | 'other' };

  /* 功能使用事件：onboarding 教育系列的判定依据。 */
  doc_created: Empty;
  template_used: Empty;
  teammate_invited: Empty;
  comment_added: Empty;
  whiteboard_created: Empty;
  integration_connected: { provider: 'slack' | 'github' | 'figma' | 'google_drive' };
  automation_created: Empty;
  api_key_created: Empty;
  mobile_app_opened: Empty;
  doc_published: Empty;

  /** workflow 自发事件：激活提醒到期（无 payload）。 */
  activation_nudge_due: Empty;
}

export interface UserProperty {
  userId: string;
  email: string;
  subscription_status: 'active' | 'none';
  subscription_plan: 'free' | 'pro' | 'business';
  auto_renew_enabled: boolean;
  docs_count: number;
}

/** 引用表：整个 DSL 仅有的两个类型注入点（drizzle 的 table 对象）。 */
export const u = user<UserProperty>();
export const e = event<Event>();
