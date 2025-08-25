import { Details, DetailType } from '../error/detail';
import { Status, StatusError } from '../error/status';
import type { AxiosError } from 'axios';
import type { Context } from 'hono';
import type { RequestIdVariables } from 'hono/request-id';
import type { HTTPResponseError, Bindings } from 'hono/types';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type Env = {
  Variables: RequestIdVariables;
  Bindings?: Bindings;
};

export function isAxiosError(payload: unknown): payload is AxiosError {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'isAxiosError' in payload &&
    payload.isAxiosError === true
  );
}

export function errorHandler<E extends Env = never>(
  error: Error | HTTPResponseError,
  c: Context<E>
): Response | Promise<Response> {
  const requestId = c.get('requestId');
  const servingData = `${c.req.method}: ${c.req.path}`;
  const details = Details.new().requestInfo({ requestId, servingData });

  if (error instanceof StatusError) {
    error.body?.error?.details?.push(...details.list);
    const badRequest = error.body?.error?.details.find((d) => d.type === DetailType.BAD_REQUEST);
    if (badRequest) console.warn(servingData, badRequest);
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

  console.error(`Unknown error: ${servingData}`, error);
  return Status.internal('Unknown error').response(details);
}
