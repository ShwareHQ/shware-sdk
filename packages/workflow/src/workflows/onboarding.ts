import { type SubFlow, type TemplateRef, not, template, trigger, workflow } from '../dsl';
import { e } from '../schema';
import {
  newUsers7d,
  usedApi,
  usedAutomations,
  usedCollaboration,
  usedIntegrations,
  usedMobile,
  usedPublishing,
  usedTemplates,
  usedWhiteboards,
} from '../segments';

/**
 * Onboarding 教育系列（功能采用 drip）。
 *
 * 结构：login 触发（限新用户，仅首次入流）→ Welcome → 每周一封教育邮件，
 * 每封只发给还没用过对应功能的人；用过的直接跳过、合流到下一个模块。
 * 同等流程在 UI 画布上约 40 个节点（8 组「分支 + 邮件 + 延迟」+ 汇合线）。
 */

/* --------------------------------- 触发 --------------------------------- */

/** 登录即入流，filter 挡住老用户。TODO: 仅首次入流（re-entry 策略）待 options 支持。 */
const login = trigger.event(e.login, { filter: newUsers7d });

/* ------------------- 模板（真实项目放 templates/，示例就近定义） ------------------- */

const welcome = template.email('onboarding_welcome');

const edu = {
  templates: template.email('edu_templates'),
  collaboration: template.email('edu_collaboration'),
  whiteboards: template.email('edu_whiteboards'),
  integrations: template.email('edu_integrations'),
  automations: template.email('edu_automations'),
  api: template.email('edu_api'),
  mobile: template.email('edu_mobile'),
  publishing: template.email('edu_publishing'),
};

/** 教育模块：发一封教育邮件，等一周（合流继续下一模块）。 */
const eduModule =
  (template: TemplateRef<'email'>): SubFlow =>
  (w) =>
    w.email(template).delay('1 week');

/* -------------------------------- workflow -------------------------------- */

export const onboardingEdu = workflow('onboarding_edu', { trigger: login })
  .email(welcome)
  .delay('1 week')
  .branch([not(usedTemplates), eduModule(edu.templates)])
  .branch([not(usedCollaboration), eduModule(edu.collaboration)])
  .branch([not(usedWhiteboards), eduModule(edu.whiteboards)])
  .branch([not(usedIntegrations), eduModule(edu.integrations)])
  .branch([not(usedAutomations), eduModule(edu.automations)])
  .branch([not(usedApi), eduModule(edu.api)])
  .branch([not(usedMobile), eduModule(edu.mobile)])
  .branch([not(usedPublishing), eduModule(edu.publishing)]);
