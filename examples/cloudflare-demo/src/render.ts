import { render } from '@react-email/render';
import type { EmailRenderer } from '../../../packages/workflow/src/cloudflare/senders';
import { emails } from '../emails';

/**
 * 应用侧渲染器：registry 查表 → react-email 渲染。
 * 引擎只传 key + 已解析的标量 props，组件从不进入引擎的世界。
 */
export const renderEmail: EmailRenderer = async (key, props) => {
  const mod = emails[key as keyof typeof emails];
  if (!mod) throw new Error(`unknown email template: ${key}`);

  const html = await render(mod.default(props as never) as never);
  const subject =
    typeof mod.subject === 'function'
      ? (mod.subject as (p: unknown) => string)(props)
      : String(mod.subject ?? key);

  return { subject, html };
};
