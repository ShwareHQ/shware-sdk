import { describe, expect, test } from 'vitest';
import { canonicalJSON, fullHash, semanticHash, sha256Hex, stripMeta } from '../src/hash';
import { eq, trigger, workflow } from '../src/index';
import { checkoutRecovery, e, nudge, reengagement, u, winback } from './fixtures';

describe('sha256Hex', () => {
  /*
   * FIPS 180-4 known-answer vectors. contentHash is a permanent contract
   * (it addresses stored versions and pins in-flight journeys), so these pin
   * the implementation, not just its behaviour.
   */
  test('matches the reference vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
    // Multi-byte UTF-8 goes through the byte path, not charCodeAt
    expect(sha256Hex('你好')).toBe(
      '670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e'
    );
  });

  test('covers block-boundary lengths (55/56/64 bytes)', () => {
    // 55 bytes: padding fits in one block; 56/64: padding spills into a second
    for (const length of [55, 56, 63, 64, 65]) {
      const input = 'a'.repeat(length);
      expect(sha256Hex(input)).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256Hex(input)).toBe(sha256Hex(input));
    }
  });
});

describe('semanticHash / fullHash', () => {
  test('are 128-bit truncations and deterministic', () => {
    expect(semanticHash({ a: 1 })).toMatch(/^[0-9a-f]{32}$/);
    expect(semanticHash({ a: 1 })).toBe(semanticHash({ a: 1 }));
  });

  test('key order does not matter (canonical JSON)', () => {
    expect(fullHash({ a: 1, b: 2 })).toBe(fullHash({ b: 2, a: 1 }));
    expect(canonicalJSON({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  test('meta / label / reason / contentHash are excluded from semanticHash but not fullHash', () => {
    const bare = { type: 'delay', duration: { value: '1 day', ms: 86_400_000 } };
    const decorated = {
      ...bare,
      label: 'Wait a day',
      reason: 'audit line',
      meta: { loc: { file: 'x.ts', line: 1, column: 1 } },
      contentHash: 'deadbeef',
    };
    expect(semanticHash(decorated)).toBe(semanticHash(bare));
    expect(fullHash(decorated)).not.toBe(fullHash(bare));
    expect(stripMeta(decorated)).toEqual(bare);
  });
});

describe('metadata is stripped by position, not by name', () => {
  /*
   * `props`, `payload` and `args` are keyed by the author, so a field of theirs
   * may be called anything — including `label` or `meta`. Stripping by name at
   * every depth erased those fields from the hash: two sends carrying different
   * values shared a contentHash, `plan` called a real change metadata-only, and
   * the deploy wrote new content under the key in-flight journeys read from.
   */
  const sendEvent = (payload: Record<string, unknown>) => ({
    id: '1',
    type: 'send_event',
    event: 'notified',
    payload,
  });

  test('a payload field named `label` is part of the hash', () => {
    expect(semanticHash(sendEvent({ label: 'old' }))).not.toBe(
      semanticHash(sendEvent({ label: 'new' }))
    );
  });

  test('so is one named `meta`, or `contentHash`', () => {
    expect(semanticHash(sendEvent({ meta: 'a' }))).not.toBe(semanticHash(sendEvent({ meta: 'b' })));
    expect(semanticHash(sendEvent({ contentHash: 'a' }))).not.toBe(
      semanticHash(sendEvent({ contentHash: 'b' }))
    );
  });

  test('the same holds for message props and action args', () => {
    const message = (props: Record<string, unknown>) => ({
      id: '1',
      type: 'message',
      channel: 'email',
      template: 't',
      props,
    });
    expect(semanticHash(message({ label: 'A' }))).not.toBe(semanticHash(message({ label: 'B' })));

    const action = (args: Record<string, unknown>) => ({
      id: '1',
      type: 'action',
      action: 'x',
      args,
    });
    expect(semanticHash(action({ meta: 'one' }))).not.toBe(semanticHash(action({ meta: 'two' })));
  });

  test('but a node label, which is what the exclusion is for, is still excluded', () => {
    const delay = (label: string) => ({
      id: '1',
      type: 'delay',
      label,
      duration: { value: '1 day', ms: 1 },
    });
    expect(semanticHash(delay('wait a bit'))).toBe(semanticHash(delay('hold')));
  });

  test('and node / workflow metadata is still excluded', () => {
    const wf = (description: string) => ({
      name: 'w',
      meta: { description, loc: { file: 'a.ts', line: 1, column: 1 } },
      flow: [{ id: '1', type: 'exit', meta: { loc: { file: 'a.ts', line: 2, column: 1 } } }],
    });
    expect(semanticHash(wf('first wording'))).toBe(semanticHash(wf('second wording')));
  });
});

describe('audit reasons are metadata, not semantics', () => {
  /*
   * An exit / filter `reason` is a string for the audit log: it cannot change
   * which path a user takes, which is the criterion this module states. Hashing
   * it meant rewording one moved the KV address the IR is stored under,
   * stranding every in-flight journey on an orphaned version and reporting a
   * semantic change in plan for a copy edit.
   */
  test('rewording an exit reason keeps contentHash stable', () => {
    const build = (reason: string) =>
      workflow('gate', { trigger: trigger.event(e.login) })
        .exit(reason)
        .toIR();

    expect(build('not eligible').contentHash).toBe(build('no longer eligible').contentHash);
  });

  test('rewording a filter reason keeps contentHash stable, but the condition still counts', () => {
    const build = (reason: string, plan: 'pro' | 'free' = 'pro') =>
      workflow('gate', { trigger: trigger.event(e.login) })
        .filter(eq(u.subscription_plan, plan), { reason })
        .toIR();

    expect(build('not eligible').contentHash).toBe(build('no longer eligible').contentHash);
    expect(build('not eligible').contentHash).not.toBe(build('not eligible', 'free').contentHash);
  });

  test('the reason survives into the IR the studio and the audit log read', () => {
    const node = workflow('gate', { trigger: trigger.event(e.login) })
      .exit('not eligible')
      .toIR().flow[0];
    expect(node).toMatchObject({ type: 'exit', reason: 'not eligible' });
  });

  test('a payload / props / args field named `reason` is still hashed', () => {
    // Author-keyed maps are never walked into, which is what keeps the
    // exclusion positional — `subscription_cancelled` genuinely has a `reason`.
    const sendEvent = (reason: string) => ({
      id: '0',
      type: 'send_event',
      event: 'subscription_cancelled',
      payload: { reason },
    });
    expect(semanticHash(sendEvent('too_expensive'))).not.toBe(semanticHash(sendEvent('other')));
  });
});

describe('contentHash is a permanent contract', () => {
  /*
   * Known answers for the fixture flows. contentHash addresses stored versions
   * and pins in-flight journeys, so a change here is a migration, never a
   * refactor — these fail loudly if the projection or the algorithm drifts.
   */
  test('the fixture workflows hash to their recorded values', () => {
    expect(checkoutRecovery.toIR().contentHash).toBe('b9d031dde655eac95a8e4d8413f04f4a');
    /*
     * winback and reengagement moved once, deliberately, when exit / filter
     * reasons left the hash (both fixtures carry an .exit('…')). That was a
     * one-off migration of the projection, not a refactor: anything deployed
     * before it keeps the old address and has to be republished. The two
     * fixtures without a reason did not move, which is the check that nothing
     * else about the projection changed with it.
     */
    expect(winback.toIR().contentHash).toBe('6822e0e7dc86bfc56f094faced85bc08');
    expect(reengagement.toIR().contentHash).toBe('343ab5c4ca158e9813810494c4a12bbd');
    expect(nudge.toIR().contentHash).toBe('b3588e5ce143a3e2c956b2fb5c313a4a');
  });
});
