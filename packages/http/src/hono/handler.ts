import type { Context } from 'hono';
import type { HTTPResponseError, Bindings } from 'hono/types';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { RequestIdVariables } from 'hono/request-id';
import type { AxiosError } from 'axios';
import { Status, StatusError } from '../status';
import { Details } from '../detail';

type Env = {
  Variables: RequestIdVariables;
  Bindings?: Bindings;
};

export function isAxiosError(payload: any): payload is AxiosError {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'isAxiosError' in payload &&
    payload.isAxiosError === true
  );
}

export function errorHandler<E extends Env = any>(
  error: Error | HTTPResponseError,
  c: Context<E>
): Response | Promise<Response> {
  const requestId = c.get('requestId');
  const servingData = `${c.req.method}: ${c.req.path}`;
  const details = Details.new().requestInfo({ requestId, servingData });

  if (error instanceof StatusError) {
    error.body?.error?.details?.push(...details.list);
    return c.json(error.body, error.status as ContentfulStatusCode);
  }

  if (error instanceof SyntaxError) {
    if (/^Cannot convert .* to a BigInt$/.test(error.message)) {
      return Status.invalidArgument(`Invalid number. ${error.message}`).response(details);
    }
  }

  if (isAxiosError(error)) {
    console.error({
      status: error.status,
      message: error.message,
      request: {
        method: error.config?.method,
        url: error.config?.url,
        data: error.config?.data,
      },
      response: { data: error.response?.data },
    });
    return Status.internal('Axios error').response(details);
  }

  console.error(error);
  return Status.internal('Unknown error').response(details);
}
