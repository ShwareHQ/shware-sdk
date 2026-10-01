import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { array, number, object, string } from 'zod/mini';
import type { ErrorBody } from '../../error/status';
import { type Env, errorHandler } from '../handler';
import { zBeaconJson, zValidator } from '../validator';

const schema = array(object({ name: string(), value: number() }));
const events = [{ name: 'page_view', value: 1 }];

function app() {
  const hono = new Hono<Env>();
  hono.onError(errorHandler);
  hono.post('/beacon', zBeaconJson(schema), (c) => c.json(c.req.valid('json')));
  hono.post('/json', zValidator('json', schema), (c) => c.json(c.req.valid('json')));
  return hono;
}

function post(path: string, body: string, type: string) {
  return app().request(path, { method: 'POST', body, headers: { 'Content-Type': type } });
}

describe('zBeaconJson', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('reads an application/json body as zValidator does', async () => {
    const res = await post('/beacon', JSON.stringify(events), 'application/json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(events);
  });

  it('reads a text/plain body as JSON, the type a beacon sends without a preflight', async () => {
    const res = await post('/beacon', JSON.stringify(events), 'text/plain;charset=UTF-8');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(events);
  });

  it('rejects malformed text as an invalid argument', async () => {
    const res = await post('/beacon', '{not json', 'text/plain');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.status).toBe('INVALID_ARGUMENT');
  });

  it('validates text/plain against the schema like JSON', async () => {
    const res = await post('/beacon', JSON.stringify([{ name: 'x' }]), 'text/plain');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(JSON.stringify(body.error.details)).toContain('0.value');
  });

  it('is needed: zValidator reads text/plain as an empty body', async () => {
    const res = await post('/json', JSON.stringify(events), 'text/plain');
    expect(res.status).toBe(400);
  });
});
