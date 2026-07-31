import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Details } from '../../error/detail';
import { type ErrorBody, Status } from '../../error/status';
import { type Env, errorHandler, isStatusError } from '../handler';

describe('errorHandler', () => {
  let app: Hono<Env>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = new Hono<Env>();
    app.use('*', requestId());
    app.onError(errorHandler);
  });

  it('should keep the status error body and attach request info', async () => {
    const details = Details.new().errorInfo({ reason: 'ACCOUNT_LOCKED' });
    app.get('/test', () => {
      throw Status.permissionDenied('locked').error(details);
    });

    const res = await app.request('/test');
    expect(res.status).toBe(403);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe('PERMISSION_DENIED');
    expect(body.error.message).toBe('locked');
    expect(body.error.details.map((d) => d['@type'])).toContain(
      'type.googleapis.com/google.rpc.RequestInfo'
    );
    expect(console.warn).toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('should log a 5xx status error at error level', async () => {
    app.get('/test', () => {
      throw Status.internal().error();
    });

    const res = await app.request('/test');
    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalled();
  });

  it('should map an HTTPException to the canonical error body', async () => {
    app.patch(
      '/test',
      validator('json', (v) => v),
      (c) => c.json({ ok: true })
    );

    const res = await app.request('/test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken":',
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe('INVALID_ARGUMENT');
    expect(body.error.message).toBe('Malformed JSON in request body');
    // A client-side mistake is not a server fault.
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [429, 'RESOURCE_EXHAUSTED'],
    [409, 'ALREADY_EXISTS'], // shared with ABORTED
    [400, 'INVALID_ARGUMENT'], // shared with FAILED_PRECONDITION and OUT_OF_RANGE
    [500, 'INTERNAL'], // shared with UNKNOWN and DATA_LOSS
    [418, 'INVALID_ARGUMENT'], // no matching code: fall back by status class
    [502, 'INTERNAL'],
  ])('should report an HTTPException with status %i as %s', async (status, expected) => {
    app.get('/test', () => {
      throw new HTTPException(status as ContentfulStatusCode);
    });

    const res = await app.request('/test');
    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe(expected);
    // The wire status always agrees with the code we report.
    expect(res.status).toBe(body.error.code);
  });

  it('should return the response an HTTPException carries', async () => {
    app.get('/test', () => {
      const res = new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="api"' },
      });
      throw new HTTPException(401, { res });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="api"');
    expect(await res.text()).toBe('Unauthorized');
  });

  it('should answer 499 when the client closed the request', async () => {
    app.get('/test', () => {
      throw new Error('socket hang up');
    });

    const controller = new AbortController();
    const request = new Request('http://localhost/test', { signal: controller.signal });
    controller.abort();

    const res = await app.request(request);
    expect(res.status).toBe(499);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe('CANCELLED');
    // Client disconnects are noise, not incidents.
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('should fall back to 500 for unknown errors', async () => {
    app.get('/test', () => {
      throw new Error('boom');
    });

    const res = await app.request('/test');
    expect(res.status).toBe(500);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe('INTERNAL');
    expect(console.error).toHaveBeenCalled();
  });

  it('should recognise a status error from another copy of the package', () => {
    const foreign = Object.assign(new Error('duplicated package'), {
      status: 404,
      body: Status.notFound().body(),
    });

    expect(isStatusError(foreign)).toBe(true);
    expect(isStatusError(new HTTPException(400))).toBe(false);
    expect(isStatusError({ isAxiosError: true, status: 500 })).toBe(false);
  });
});
