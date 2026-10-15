import type { ChannelIR } from '../ir';

/**
 * Channel → the user property holding its recipient address. The engine
 * resolves it before sending, which keeps senders stateless. Push is absent on
 * purpose: its recipients are devices, kept in the store. Slack and Discord post to a team
 * channel through the template's webhook, so they have no per-user address either.
 * TODO: let the app override this table (today it is a convention, with
 * UserPropertyBase guaranteeing `email` exists).
 */
export const RECIPIENT_PROPERTY: Record<ChannelIR, string | undefined> = {
  email: 'email',
  sms: 'phone',
  push: undefined,
  slack: undefined,
  discord: undefined,
  survey: 'email',
  in_app: undefined,
};
