import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import * as mini from 'zod/mini';
import { defineContract } from '../src/contract';
import { trigger, workflow } from '../src/dsl';
import { type EngineStep, type FactSource, type JourneyContext, runJourney } from '../src/engine';
import { handleTracking } from '../src/reporting/tracking';
import type { JourneyReporting } from '../src/store';
import { PostgresJourneyStore, type SqlClientLike } from '../src/store/postgres';
import { assertSupportedSchema } from '../src/templates';
import { e, namedPush } from './fixtures';

const MESSAGE_ID = '0190f000-0000-7000-8000-000000000000';

function emptyReporting() {
  const sql: SqlClientLike = { query: async () => [], transaction: async (run) => run(sql) };
  const query = vi.spyOn(sql, 'query');
  return { query, reporting: new PostgresJourneyStore(sql).reporting };
}

describe('SQL row boundaries', () => {
  test('missing messages cannot record opens, clicks or unsubscribes', async () => {
    const { reporting } = emptyReporting();
    const open = vi.fn<Parameters<JourneyReporting['recordOpen']>[1]>();
    const click = vi.fn<Parameters<JourneyReporting['recordClick']>[4]>();

    expect(await reporting.recordOpen(MESSAGE_ID, open)).toBe(false);
    expect(await reporting.recordClick(MESSAGE_ID, 0, 1000, 100, click)).toBeUndefined();
    expect(await reporting.recordUnsubscribe(MESSAGE_ID, 1000)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  test('an existing message without the requested link is not judged as a click', async () => {
    const { query, reporting } = emptyReporting();
    query.mockResolvedValueOnce([{ delivered_at: 1000 }]);
    const judge = vi.fn<Parameters<JourneyReporting['recordClick']>[4]>();

    expect(await reporting.recordClick(MESSAGE_ID, 9, 2000, 100, judge)).toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('a missing INSERT RETURNING row retains the recording error', async () => {
    const { reporting } = emptyReporting();
    await expect(
      reporting.recordMessage({
        idempotencyKey: 'copy-1',
        workflow: 'welcome',
        instanceId: 'instance-1',
        nodeId: '0',
        template: 'hello',
        channel: 'email',
        userId: 'user-1',
        sentAt: 1000,
      })
    ).rejects.toThrow('message copy-1 was not recorded');
  });
});

test.each(['/', '/t', '/t/l', `/t/l/${MESSAGE_ID}`, `/t/u/${MESSAGE_ID}`, `/t/c/${MESSAGE_ID}`])(
  'an incomplete tracking path %s passes through without querying',
  async (path) => {
    const { query, reporting } = emptyReporting();
    expect(
      await handleTracking(new Request(`https://workflow.example${path}`), reporting)
    ).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  }
);

test('a pre-per-device push checkpoint skips delivery rather than sending the push again', async () => {
  const checkpoints = new Map<string, unknown>([['0:send', undefined]]);
  const step: EngineStep = {
    async do<T>(name: string, run: () => Promise<T>): Promise<T> {
      // A durable store decodes historical JSON before the current callback's type exists.
      if (checkpoints.has(name)) return checkpoints.get(name) as T;
      return run();
    },
    sleep: async () => {},
    sleepUntil: async () => {},
    subscribe: async () => {},
    unsubscribe: async () => {},
    waitForWake: async () => 'timeout',
  };
  const listDevices = vi.fn<FactSource['listDevices']>(async () => [
    { token: 'phone', platform: 'ios' },
  ]);
  const send = vi.fn<JourneyContext['messages']['send']>(async () => {});
  const context: JourneyContext = {
    userId: 'user-1',
    instanceId: 'instance-1',
    enteredAtMs: 0,
    step,
    facts: {
      countEvents: async () => 0,
      getProperty: async () => undefined,
      getSegmentCondition: async () => undefined,
      listDevices,
    },
    messages: { send },
    events: { emit: async () => {} },
  };
  const ir = workflow({ id: 'legacy', trigger: trigger.event(e.login) })
    .push(namedPush('hello'), { name: 'Ada' })
    .toIR();

  expect(await runJourney(ir, context)).toEqual({ status: 'completed' });
  expect(listDevices).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

describe('unknown schema declarations', () => {
  test.each([undefined, null, 42, 'not a schema', {}, { _zod: {} }])(
    'rejects malformed input %j at both declaration boundaries',
    (schema) => {
      expect(() => assertSupportedSchema(schema, 'bad')).toThrow(/unsupported props schema/);
      expect(() =>
        defineContract({
          events: { bad: schema as never },
          profile: z.strictObject({}),
        })
      ).toThrow(/not a Zod schema/);
    }
  );

  test('accepts the supported object shape from both Zod Classic and Mini', () => {
    for (const schema of [
      z.strictObject({ name: z.string() }),
      mini.strictObject({ name: mini.string() }),
    ]) {
      expect(() => assertSupportedSchema(schema, 'name')).not.toThrow();
      expect(() => defineContract({ events: { named: schema }, profile: schema })).not.toThrow();
    }
  });
});
