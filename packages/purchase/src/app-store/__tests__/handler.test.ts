import { describe, expect, it, vi } from 'vitest';
import { type AppStoreNotificationEvent, AppStoreNotificationHandler } from '../handler';

const event = (notificationType?: string) =>
  ({
    payload: { notificationType },
    transaction: null,
    renewalInfo: null,
  }) as unknown as AppStoreNotificationEvent;

describe('AppStoreNotificationHandler', () => {
  it('runs every handler registered for the type', async () => {
    const first = vi.fn<() => Promise<void>>(async () => {});
    const second = vi.fn<() => Promise<void>>(async () => {});
    await AppStoreNotificationHandler.create()
      .on('DID_RENEW' as never, first)
      .on('DID_RENEW' as never, second)
      .process(event('DID_RENEW'));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('acknowledges a type with no handler, or none at all, instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = AppStoreNotificationHandler.create().on('DID_RENEW' as never, async () => {});
    await expect(handler.process(event('SOMETHING_NEW'))).resolves.toBeUndefined();
    await expect(handler.process(event())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
