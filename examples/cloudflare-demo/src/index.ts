import type { JourneyEnv } from '../../../packages/workflow/src/cloudflare/bindings';
import { deployBundle, handleRequest } from '../../../packages/workflow/src/cloudflare/router';
import { demoBundle } from './journeys';

/** 通用旅程执行器：wrangler workflows 绑定的 class_name。 */
export { JourneyRunner } from '../../../packages/workflow/src/cloudflare/runner';

export default {
  async fetch(request: Request, env: JourneyEnv): Promise<Response> {
    const url = new URL(request.url);

    // 演示便捷端点：服务端编译 demo bundle 并部署（真实项目走 CLI POST /deploy）
    if (request.method === 'POST' && url.pathname === '/deploy-demo') {
      const result = await deployBundle(env, demoBundle());
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return handleRequest(request, env);
  },
};
