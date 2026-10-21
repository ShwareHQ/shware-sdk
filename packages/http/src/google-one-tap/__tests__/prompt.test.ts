// oxlint-disable typescript/no-deprecated -- getSkippedReason is deprecated but still stubbed here.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { prompt } from '../index';
import type { PromptMomentNotification } from '../types';

type Moment = Partial<PromptMomentNotification>;

function notification(moment: Moment): PromptMomentNotification {
  return {
    isSkippedMoment: () => false,
    isDismissedMoment: () => false,
    getDismissedReason: () => {
      throw new Error('getDismissedReason called on a non-dismissed moment');
    },
    ...moment,
  } as PromptMomentNotification;
}

/** Stubs the GSI script and `google.accounts.id`, replaying `moments` on prompt(). */
function stubGoogle(moments: Moment[], credential?: { credential: string }) {
  const id = {
    initialize: vi.fn<(config: { callback: (credential: unknown) => void }) => void>(),
    prompt: vi.fn<(listener: (n: PromptMomentNotification) => void) => void>((listener) => {
      for (const moment of moments) listener(notification(moment));
      if (credential) {
        id.initialize.mock.calls[0]?.[0].callback({ ...credential, select_by: 'auto' });
      }
    }),
  };
  vi.stubGlobal('window', { IdentityCredential: class {}, google: { accounts: { id } } });
  vi.stubGlobal('document', {
    createElement: () => ({}),
    head: {
      appendChild: (script: { onload?: () => void }) => script.onload?.(),
    },
  });
}

describe('google one tap prompt outcome', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  test('skipped with reason', async () => {
    stubGoogle([{ isSkippedMoment: () => true, getSkippedReason: () => 'tap_outside' }]);
    const result = await prompt({ client_id: 'client' });
    expect(result).toEqual({
      authorized: false,
      outcome: { type: 'skipped', reason: 'tap_outside' },
      moment: { skipped: true, dismissed: false, dismissedReason: undefined },
    });
  });

  test('skipped reason is undefined when getSkippedReason throws', async () => {
    stubGoogle([
      {
        isSkippedMoment: () => true,
        getSkippedReason: () => {
          throw new Error('not supported under FedCM');
        },
      },
    ]);
    const result = await prompt({ client_id: 'client' });
    expect(result).toMatchObject({ outcome: { type: 'skipped', reason: undefined } });
  });

  test('skipped reason is undefined when getSkippedReason is missing', async () => {
    stubGoogle([{ isSkippedMoment: () => true }]);
    const result = await prompt({ client_id: 'client' });
    expect(result).toMatchObject({ outcome: { type: 'skipped', reason: undefined } });
  });

  test('skipped reason drops unknown values', async () => {
    stubGoogle([
      {
        isSkippedMoment: () => true,
        getSkippedReason: () => 'something_new' as unknown as 'auto_cancel',
      },
    ]);
    const result = await prompt({ client_id: 'client' });
    expect(result).toMatchObject({ outcome: { type: 'skipped', reason: undefined } });
  });

  test('skipped moment never carries a dismissed reason', async () => {
    const getDismissedReason = vi.fn<PromptMomentNotification['getDismissedReason']>(
      () => 'cancel_called'
    );
    stubGoogle([
      { isSkippedMoment: () => true, getSkippedReason: () => 'auto_cancel', getDismissedReason },
    ]);
    const result = await prompt({ client_id: 'client' });
    expect(getDismissedReason).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: { type: 'skipped', reason: 'auto_cancel' },
      moment: { dismissedReason: undefined },
    });
  });

  test('dismissed cancel_called', async () => {
    stubGoogle([{ isDismissedMoment: () => true, getDismissedReason: () => 'cancel_called' }]);
    const result = await prompt({ client_id: 'client' });
    expect(result).toEqual({
      authorized: false,
      outcome: { type: 'dismissed', reason: 'cancel_called' },
      moment: { skipped: false, dismissed: true, dismissedReason: 'cancel_called' },
    });
  });

  test('credential_returned is not reported as an outcome', async () => {
    stubGoogle(
      [{ isDismissedMoment: () => true, getDismissedReason: () => 'credential_returned' }],
      {
        credential: 'id-token',
      }
    );
    const result = await prompt({ client_id: 'client' });
    expect(result).toEqual({
      authorized: true,
      credential: { credential: 'id-token', select_by: 'auto' },
    });
  });
});
