// @vitest-environment node
import { resolve } from 'node:path';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startStudio } from '../src/server';

const cwd = resolve(import.meta.dirname, 'fixtures/stats');
let server: ViteDevServer;
let origin: string;

beforeAll(async () => {
  server = await startStudio({ cwd, port: 4399 });
  const address = server.httpServer?.address();
  origin = `http://localhost:${typeof address === 'object' && address !== null ? address.port : 4399}`;
}, 30_000);

afterAll(async () => {
  await server.close();
});

const call = (method: string, args: unknown[] = [], headers: Record<string, string> = {}) =>
  fetch(`${origin}/__studio/stats/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(args),
  });

describe('the stats source runs on the studio server', () => {
  test('a method answers with its JSON, arguments passed through', async () => {
    const reports = await call('reports');
    expect(reports.status).toBe(200);
    expect(await reports.json()).toEqual([
      { id: 'onboarding', entered: 3, completed: 1, converted: 1, active: 2 },
    ]);
    expect(await (await call('nodeStats', ['onboarding'])).json()).toEqual({ 'onboarding:0': 2 });
  });

  test('a method the source does not define, or that is not a stats method, is a 404', async () => {
    expect((await call('links')).status).toBe(404);
    expect((await call('constructor')).status).toBe(404);
  });

  test('a throwing method is a 500 with its message', async () => {
    const failed = await call('segments');
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'segments are down' });
  });

  test('another site cannot call it', async () => {
    expect((await call('reports', [], { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  test('only POST', async () => {
    expect((await fetch(`${origin}/__studio/stats/reports`)).status).toBe(405);
  });
});
