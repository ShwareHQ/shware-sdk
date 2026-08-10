import * as offer from './offer';
import * as welcome from './welcome';

/**
 * 邮件 registry：唯一注册处。
 * key 在这里定义，DSL 侧 `templates<Emails>()` 据此做编译期校验——
 * 引用未注册的 key 直接编译不过（不需要测试兜底）。
 */
export const emails = {
  demo_welcome: welcome,
  demo_offer: offer,
} as const;

export type Emails = typeof emails;
export type EmailKey = keyof Emails;
