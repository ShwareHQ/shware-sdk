import type { ReactElement } from 'react';
import * as firstTimeRecovery from './first-time-recovery';
import * as limitedTimeOffer from './limited-time-offer';
import * as onboardingWelcome from './onboarding-welcome';
import * as upgradeRecovery from './upgrade-recovery';

/**
 * 邮件 registry：key 与 DSL 里 template.email(key) 的 key 一一对应。
 * 只注册了 checkout 挽回与 welcome 四封——其余 key 在模板页显示为
 * "未注册"，这正是"流程引用了但内容还没写"的审计信号。
 */
export const emails = {
  u1_upgrade_recovery: upgradeRecovery,
  n1_first_time_recovery: firstTimeRecovery,
  n2_limited_time_offer: limitedTimeOffer,
  onboarding_welcome: onboardingWelcome,
} as const;

export type Emails = typeof emails;

/**
 * 单个模板模块的形状：默认导出组件，可选 subject / preview props。
 * props 用 never（逆变位）以接纳任意 props 形状的组件。
 */
export interface EmailModule {
  default: (props: never) => ReactElement;
  subject?: (props: never) => string;
  preview?: object;
}

/** 按 key 查模块：未注册的 key 返回 undefined（类型上要体现）。 */
export const emailModules: Record<string, EmailModule | undefined> = emails;
