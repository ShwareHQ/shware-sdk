import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { evaluateCondition } from '../src/engine/condition';
import { runJourney } from '../src/engine/interpreter';
import type { EngineStep, FactSource, JourneyContext, OutboundMessage } from '../src/engine/ports';
import { parseBatch } from '../src/host/batch';
import { MAX_EVENT_PAYLOAD_BYTES, payloadSizeError } from '../src/host/ingest';
import {
  type PinnedWorkflow,
  action,
  and,
  checkInFlight,
  compileBundle,
  compileConfig,
  defineConfig,
  defineContract,
  emailTemplate,
  eq,
  event,
  exists,
  gte,
  segment,
  trigger,
  user,
  workflow,
} from '../src/index';
import type { ScalarIR } from '../src/ir';

/**
 * `t.payload.<field>`: the payload of the event that started a journey, read anywhere in the
 * workflow that event triggers. The value is the instance's own (its params), so a later
 * occurrence of the event changes nothing a running journey reads.
 */

interface Events {
  begin_checkout: {
    value: number;
    currency: string;
    coupon?: string;
    /** Field names a ref's own state must not shadow. */
    type: string;
    path: string;
    cart: { items: number; first: { sku: string } };
  };
  purchase: { value: number };
  cart_summary: { total: number; currency: string };
}

const e = event<Events>();
const u = user<{ userId: string; plan: string }>();

const offer = emailTemplate({
  id: 'offer',
  transactional: true,
  from: 'noreply@acme.test',
  title: 'Offer',
  props: z.strictObject({
    total: z.number(),
    currency: z.string(),
    coupon: z.optional(z.string()),
  }),
  subject: 'Your cart',
  preview: { total: 1, currency: 'USD' },
  component: () => null,
});
const plain = (id: string) =>
  emailTemplate({
    id,
    transactional: true,
    from: 'noreply@acme.test',
    title: id,
    props: z.strictObject({}),
    subject: id,
    preview: {},
    component: () => null,
  });
const vip = plain('vip');
const reminder = plain('reminder');

const seen: Record<string, unknown>[] = [];
const record = action<{ sku: string; items: number }>('record', async (args) => {
  seen.push(args);
});

const checkout = trigger.event(e.begin_checkout);

const recovery = workflow({ id: 'recovery', reentry: { mode: 'never' }, trigger: checkout })
  .branch([gte(checkout.payload.value, 100), (w) => w.email(vip)], (w) => w.email(reminder))
  .email(offer, {
    total: checkout.payload.value,
    currency: checkout.payload.currency,
    coupon: checkout.payload.coupon,
  })
  .sendEvent(e.cart_summary, {
    total: checkout.payload.value,
    currency: checkout.payload.currency,
  })
  .run(record, { sku: checkout.payload.cart.first.sku, items: checkout.payload.cart.items });

/* ------------------------------ in-memory ports ------------------------------ */

const step: EngineStep = {
  do: async (_name, fn) => fn(),
  sleep: async () => {},
  subscribe: async () => {},
  unsubscribe: async () => {},
  waitForWake: async () => 'timeout',
};

const facts: FactSource = {
  countEvents: async () => 0,
  getProperty: async (path) => (path === 'email' ? 'ada@example.com' : undefined),
  getSegmentCondition: async () => undefined,
  listDevices: async () => [],
};

function run(payload: Record<string, unknown> | undefined) {
  const sent: OutboundMessage[] = [];
  const emitted: { event: string; payload: Record<string, ScalarIR | undefined> }[] = [];
  const ctx: JourneyContext = {
    userId: 'u1',
    instanceId: 'i1',
    enteredAtMs: 1_000,
    triggerPayload: payload,
    step,
    facts,
    messages: {
      send: async (message) => {
        sent.push(message);
      },
    },
    events: {
      emit: async (name, emittedPayload) => {
        emitted.push({ event: name, payload: emittedPayload });
      },
    },
    actions: {
      invoke: async ({ args }) => {
        seen.push(args);
      },
    },
  };
  return { ctx, sent, emitted };
}

const cart = (value: number, extra: Record<string, unknown> = {}) => ({
  value,
  currency: 'EUR',
  cart: { items: 2, first: { sku: 'sku_9' } },
  ...extra,
});

/* ----------------------------------- DSL ------------------------------------ */

describe('compiling', () => {
  test('a predicate and a value compile to references naming the trigger event and the field', () => {
    const ir = recovery.toIR();
    const [branch, email, emit, act] = ir.flow;
    expect(branch).toMatchObject({
      type: 'branch',
      cases: [
        {
          condition: {
            type: 'trigger_payload',
            event: 'begin_checkout',
            path: 'value',
            op: 'gte',
            value: 100,
          },
        },
      ],
    });
    expect(email).toMatchObject({
      props: {
        total: { type: 'trigger_payload', event: 'begin_checkout', path: 'value' },
        currency: { type: 'trigger_payload', event: 'begin_checkout', path: 'currency' },
      },
    });
    expect(emit).toMatchObject({
      payload: { total: { type: 'trigger_payload', event: 'begin_checkout', path: 'value' } },
    });
    expect(act).toMatchObject({
      args: {
        sku: { type: 'trigger_payload', event: 'begin_checkout', path: 'cart.first.sku' },
        items: { type: 'trigger_payload', event: 'begin_checkout', path: 'cart.items' },
      },
    });
  });

  test('a field named like a ref’s own state is a field: `type` and `path` are sub-references', () => {
    const ir = workflow({ id: 'names', reentry: { mode: 'never' }, trigger: checkout })
      .filter(and(eq(checkout.payload.type, 'guest'), eq(checkout.payload.path, '/cart')))
      .toIR();
    expect(ir.flow[0]).toMatchObject({
      condition: {
        conditions: [
          { type: 'trigger_payload', path: 'type', value: 'guest' },
          { type: 'trigger_payload', path: 'path', value: '/cart' },
        ],
      },
    });
  });

  test('a workflow that reads nothing from its trigger hashes as it did before the handle existed', () => {
    const before = workflow({
      id: 'same',
      reentry: { mode: 'never' },
      trigger: trigger.event(e.begin_checkout),
    }).email(reminder);
    // The trigger's IR carries no trace of the handle
    expect(before.toIR().trigger).toEqual({ type: 'event', event: 'begin_checkout' });
  });

  test('compileBundle: a reference taken from another trigger is refused, with the node named', () => {
    const purchase = trigger.event(e.purchase);
    const mixed = workflow({ id: 'mixed', reentry: { mode: 'never' }, trigger: checkout }).filter(
      gte(purchase.payload.value, 10)
    );
    expect(() => compileBundle({ workflows: [mixed] })).toThrow(
      /workflow 'mixed' node \S+ reads 'value' from the payload of a 'purchase' trigger, but the workflow is triggered by 'begin_checkout'/
    );
  });

  test('compileBundle: a segment has no journey to read a payload from', () => {
    const big = segment({ id: 'big', condition: exists(checkout.payload.coupon) });
    expect(() => compileBundle({ workflows: [], segments: [big] })).toThrow(
      /segment 'big' reads the trigger payload \('coupon'\)/
    );
  });

  test('compileBundle: a workflow with a segment trigger has no payload to read', () => {
    const pro = segment({ id: 'pro', condition: eq(u.plan, 'pro') });
    const bySegment = workflow({
      id: 'by_segment',
      reentry: { mode: 'never' },
      trigger: trigger.enters(pro),
    }).email(offer, { total: checkout.payload.value, currency: 'EUR' });
    expect(() => compileBundle({ workflows: [bySegment], segments: [pro] })).toThrow(
      /workflow 'by_segment' node \S+ reads 'value' from the payload of a 'begin_checkout' trigger, but the workflow has a segment trigger/
    );
  });

  test('compileBundle: a trigger filter tests the profile; the payload belongs in its where clause', () => {
    const filtered = workflow({
      id: 'filtered',
      reentry: { mode: 'never' },
      trigger: trigger.event(e.begin_checkout, { filter: gte(checkout.payload.value, 100) }),
    }).email(reminder);
    expect(() => compileBundle({ workflows: [filtered] })).toThrow(
      /workflow 'filtered' trigger filter reads the trigger payload \('value'\)/
    );
  });
});

/* ---------------------------------- engine ---------------------------------- */

describe('running', () => {
  test('conditions, props, emitted payloads and action args read the payload the journey entered with', async () => {
    seen.length = 0;
    const { ctx, sent, emitted } = run(cart(120, { coupon: 'SPRING' }));
    await runJourney(recovery.toIR(), ctx);

    expect(sent.map((message) => message.template)).toEqual(['vip', 'offer']);
    expect(sent[1]?.props).toEqual({ total: 120, currency: 'EUR', coupon: 'SPRING' });
    expect(emitted).toEqual([{ event: 'cart_summary', payload: { total: 120, currency: 'EUR' } }]);
    expect(seen).toEqual([{ sku: 'sku_9', items: 2 }]);
  });

  test('the other arm is taken below the threshold; a field the event left out is undefined', async () => {
    const { ctx, sent } = run(cart(40));
    await runJourney(recovery.toIR(), ctx);

    expect(sent.map((message) => message.template)).toEqual(['reminder', 'offer']);
    expect(sent[1]?.props).toEqual({ total: 40, currency: 'EUR', coupon: undefined });
  });

  test('an object is not a value: only a scalar leaf reaches a prop, while exists sees the object', async () => {
    const ir = workflow({ id: 'shapes', reentry: { mode: 'never' }, trigger: checkout })
      .filter(exists(checkout.payload.cart))
      .run(record, { sku: checkout.payload.cart as never, items: 1 })
      .toIR();
    seen.length = 0;
    const { ctx } = run(cart(1));
    await runJourney(ir, ctx);
    expect(seen).toEqual([{ sku: undefined, items: 1 }]);
  });

  test('outside a journey there is no trigger payload: evaluating the predicate is an error', async () => {
    const condition = recovery.toIR().flow[0];
    if (condition.type !== 'branch') throw new Error('expected the branch');
    await expect(evaluateCondition(condition.cases[0].condition, facts, 0)).rejects.toThrow(
      /only valid in the workflow their event triggers/
    );
  });
});

/* --------------------------------- contract --------------------------------- */

const contractWith = (checkoutShape: z.ZodObject) =>
  defineContract({
    events: {
      begin_checkout: checkoutShape,
      purchase: z.looseObject({ value: z.number() }),
      cart_summary: z.looseObject({ total: z.number(), currency: z.string() }),
    },
    profile: z.strictObject({ email: z.optional(z.email()) }),
  });

const full = z.looseObject({
  value: z.number(),
  currency: z.string(),
  coupon: z.optional(z.string()),
  type: z.string(),
  path: z.string(),
  cart: z.optional(z.looseObject({ items: z.number(), first: z.looseObject({ sku: z.string() }) })),
});

const configWith = (checkoutShape: z.ZodObject) =>
  defineConfig({
    contract: contractWith(checkoutShape),
    workflows: [recovery],
    actions: [record],
    templates: { email: { offer, vip, reminder } },
  } as never);

describe('against the contract', () => {
  test('every field read is one the event declares, through optional and nested objects', () => {
    expect(() => compileConfig(configWith(full))).not.toThrow();
  });

  test('a field the event does not declare fails the compile, with the node and the path', () => {
    const withoutSku = z.looseObject({
      value: z.number(),
      currency: z.string(),
      coupon: z.optional(z.string()),
      cart: z.looseObject({ items: z.number(), first: z.looseObject({}) }),
    });
    expect(() => compileConfig(configWith(withoutSku))).toThrow(
      /workflow 'recovery' node \S+: reads 'cart.first.sku' from the payload of 'begin_checkout', which the contract does not declare/
    );
  });

  test('checkInFlight: a field dropped from the event is reported for the journeys still reading it', () => {
    const ir = compileConfig(configWith(full)).workflows[0];
    const pinned: PinnedWorkflow[] = [
      { workflow: ir.id, contentHash: ir.contentHash, running: 4, ir },
    ];
    const next = configWith(
      z.looseObject({
        value: z.number(),
        coupon: z.optional(z.string()),
        cart: z.looseObject({ items: z.number(), first: z.looseObject({ sku: z.string() }) }),
      })
    );
    const problems = checkInFlight(
      pinned,
      compileBundle({ workflows: [recovery], actions: [record] }),
      next
    );
    expect(problems.map((p) => p.problem)).toEqual([
      expect.stringMatching(/reads 'currency' from the payload of 'begin_checkout'/),
    ]);
    expect(
      checkInFlight(
        pinned,
        compileBundle({ workflows: [recovery], actions: [record] }),
        configWith(full)
      )
    ).toEqual([]);
  });
});

/* ------------------------------- payload size -------------------------------- */

describe('payload size', () => {
  const big = { note: 'x'.repeat(MAX_EVENT_PAYLOAD_BYTES) };

  test('a payload at the limit fits; one byte over is refused with both sizes', () => {
    const overhead = JSON.stringify({ note: '' }).length;
    const fits = { note: 'x'.repeat(MAX_EVENT_PAYLOAD_BYTES - overhead) };
    expect(payloadSizeError('login', fits)).toBeUndefined();
    expect(payloadSizeError('login', { note: `${fits.note}x` })).toBe(
      `event 'login': payload is ${MAX_EVENT_PAYLOAD_BYTES + 1} bytes as JSON, over the ${MAX_EVENT_PAYLOAD_BYTES}-byte limit`
    );
  });

  test('the size is counted in UTF-8 bytes, not characters', () => {
    const overhead = JSON.stringify({ note: '' }).length;
    const chars = Math.floor((MAX_EVENT_PAYLOAD_BYTES - overhead) / 3) + 1;
    expect(payloadSizeError('login', { note: '字'.repeat(chars) })).toMatch(/over the/);
  });

  test('a batch carrying one oversized event is refused whole', () => {
    const parsed = parseBatch(
      { userId: 'u1', events: [{ event: 'login' }, { event: 'note_saved', payload: big }] },
      { mode: 'enforce' }
    );
    expect(parsed).toMatchObject({
      ok: false,
      error: expect.stringMatching(/event 'note_saved': payload is \d+ bytes/),
    });
  });
});
