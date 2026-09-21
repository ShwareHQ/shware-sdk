/**
 * The lock-screen half of U1: sent in the same step as the upgrade-recovery
 * email, so a subscriber who never opens the inbox still sees the nudge.
 */

export const name = 'Checkout · Reminder';
export const description =
  'Lands with the upgrade-recovery email an hour after an abandoned checkout.';

export const title = 'Your upgrade is one tap away';
export const body =
  'Pick up where you left off — your plan is saved at checkout. Nothing has been charged.';
