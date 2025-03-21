import type { Context } from 'hono';
import type { HTTPResponseError, Bindings } from 'hono/types';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { RequestIdVariables } from 'hono/request-id';
import { Status, StatusError } from '../status';
import { Details } from '../detail';

type Env = {
  Variables: RequestIdVariables;
  Bindings?: Bindings;
};

export function errorHandler<E extends Env = any>(
  error: Error | HTTPResponseError,
  c: Context<E>
): Response | Promise<Response> {
  if (error instanceof StatusError) {
    const requestId = c.get('requestId');
    const servingData = `${c.req.method}: ${c.req.url}`;
    const details = Details.new().requestInfo({ requestId, servingData });
    error.body?.error?.details?.push(...details.list);
    return c.json(error.body, error.status as ContentfulStatusCode);
  }

  return c.json(Status.internal(error.message).response(), 500);
}
