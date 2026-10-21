import { createElement } from 'react';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { journeyLambda } from '../src/aws';
import { stepRetry } from '../src/aws/engine-step';
import { journeyWorker } from '../src/cloudflare/worker';
import { compileConfig } from '../src/config';
import { longestJourneyMs } from '../src/engine/duration';
import { isRetryable } from '../src/engine/retry';
import { defineConfig, emailTemplate, event, performed, trigger, workflow } from '../src/index';
import { D1JourneyStore } from '../src/store/d1';
import { PostgresJourneyStore } from '../src/store/postgres';
import { TemplateValidationError } from '../src/templates';
import { CloudflareEmailError } from '../src/transports/cloudflare-email';
import { SesSendError } from '../src/transports/ses';
import { FakeD1 } from './fake-cloudflare';

/**
 * Leftovers of the AWS review: a host that would email with no transport fails when it is
 * created, deterministic refusals are not retried on either runtime, and a workflow that can
 * outlive the Lambda execution timeout fails the handler's creation.
 */

const e = event<{ login: Record<string, never>; purchase: { value: number } }>();
const hi = emailTemplate({
  id: 'hi',
  from: 'hi@acme.test',
  title: 'Hi',
  props: z.strictObject({}),
  subject: 'Hi',
  preview: {},
  component: () => createElement('p', null, 'hi'),
});

describe('a host without an email transport', () => {
  const store = () => new D1JourneyStore(new FakeD1());

  test('fails when created if a workflow sends email, naming the workflows', () => {
    const config = defineConfig({
      workflows: [
        workflow({ id: 'welcome', trigger: trigger.event(e.login) }).branch(
          [performed(e.purchase), (f) => f.email(hi, {})],
          (f) => f.delay('1 day')
        ),
      ],
      templates: { email: { hi } },
    });
    expect(() => journeyWorker({ config, store })).toThrow(
      /workflows 'welcome' send email, but the host has no `email` transport/
    );
    expect(() =>
      journeyLambda({ config, env: {}, store: () => new PostgresJourneyStore({} as never) })
    ).toThrow(/no `email` transport/);
  });

  test('is fine when no workflow emails, or when `messages` replaces every channel', () => {
    const quiet = defineConfig({
      workflows: [workflow({ id: 'wait', trigger: trigger.event(e.login) }).delay('1 day')],
      templates: { email: { hi } },
    });
    expect(() => journeyWorker({ config: quiet, store })).not.toThrow();
    const emailing = defineConfig({
      workflows: [workflow({ id: 'w', trigger: trigger.event(e.login) }).email(hi, {})],
      templates: { email: { hi } },
    });
    expect(() =>
      journeyWorker({ config: emailing, store, messages: () => ({ send: async () => {} }) })
    ).not.toThrow();
  });
});

describe('isRetryable', () => {
  test("the engine's deterministic refusals are never retried", () => {
    expect(isRetryable(new TemplateValidationError('email', 'hi', 'props', []))).toBe(false);
    expect(isRetryable(new Error('socket hang up'))).toBe(true);
    expect(isRetryable('not an error')).toBe(true);
  });

  test('a provider rejecting the request is not retried; throttling and its own faults are', () => {
    expect(isRetryable(new SesSendError(400, 'MessageRejected', 'not verified'))).toBe(false);
    expect(isRetryable(new SesSendError(403, 'AccessDeniedException', 'denied'))).toBe(false);
    expect(isRetryable(new SesSendError(429, 'TooManyRequestsException', 'slow down'))).toBe(true);
    expect(isRetryable(new SesSendError(503, undefined, 'unavailable'))).toBe(true);
    expect(isRetryable(new CloudflareEmailError(401, [{ code: 10101 }]))).toBe(false);
    expect(isRetryable(new CloudflareEmailError(429, [{ code: 10004 }]))).toBe(true);
    // success: false on a 200 says nothing either way: retried
    expect(isRetryable(new CloudflareEmailError(200, []))).toBe(true);
  });

  test('the AWS step follows the same rule', () => {
    expect(stepRetry(new SesSendError(400, 'MessageRejected', 'x'), 1)).toEqual({
      shouldRetry: false,
    });
    expect(stepRetry(new SesSendError(500, undefined, 'x'), 1)).toMatchObject({
      shouldRetry: true,
    });
  });
});

describe('longestJourneyMs', () => {
  const DAY = 86_400_000;
  const ir = (flow: ReturnType<typeof workflow>) =>
    compileConfig(defineConfig({ workflows: [flow], templates: { email: { hi } } })).workflows[0];

  test('delays add up; waits count to their timeout; the longest arm wins', () => {
    const flow = workflow({ id: 'w', trigger: trigger.event(e.login) })
      .delay('2 days')
      .waitUntil(performed(e.purchase), {
        timeout: '3 days',
        onTimeout: (f) => f.delay('1 day'),
      })
      .branch([performed(e.purchase), (f) => f.delay('10 days')], (f) => f.delay('1 day'))
      .email(hi, {});
    expect(longestJourneyMs(ir(flow))).toBe((2 + 3 + 1 + 10) * DAY);
  });

  test("a goal's window keeps the instance alive past its last step", () => {
    const flow = workflow({
      id: 'w',
      trigger: trigger.event(e.login),
      goal: { condition: performed(e.purchase), within: '30 days' },
    }).delay('1 day');
    expect(longestJourneyMs(ir(flow))).toBe(30 * DAY);
  });
});

describe('journeyLambda({ executionTimeoutMs })', () => {
  const config = defineConfig({
    workflows: [
      workflow({ id: 'long', trigger: trigger.event(e.login) })
        .delay('40 days')
        .email(hi, {}),
      workflow({ id: 'short', trigger: trigger.event(e.login) })
        .delay('1 day')
        .email(hi, {}),
    ],
    templates: { email: { hi } },
  });
  const base = {
    config,
    env: {},
    store: () => new PostgresJourneyStore({} as never),
    email: () => ({ send: async () => ({}) }),
  };

  test('a workflow that can outlive the execution timeout fails the handler’s creation', () => {
    expect(() => journeyLambda({ ...base, executionTimeoutMs: 30 * 86_400_000 })).toThrow(
      /'long' can run 40 days, longer than the execution timeout \(30 days\)/
    );
  });

  test('within the timeout, or without the option, the handler is created', () => {
    expect(() => journeyLambda({ ...base, executionTimeoutMs: 366 * 86_400_000 })).not.toThrow();
    expect(() => journeyLambda(base)).not.toThrow();
  });
});
