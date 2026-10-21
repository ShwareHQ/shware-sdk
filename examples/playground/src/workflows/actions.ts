import { action } from '@shware/workflow';

/**
 * A custom action: plain code for what the built-in nodes do not cover. The
 * chain records only its identity (name + args); this function
 * ships with the deployed Worker and runs inside a durable step — retried on
 * throw, so keep it idempotent. Custom *conditions* stay unsupported by
 * design: an action writes data, and branching reads it declaratively.
 */
export const issueCoupon = action<{ code: string; email: string }>(
  'issue_coupon',
  async ({ code, email }, { userId }) => {
    await fetch('https://billing.acme.io/coupons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, email, userId }),
    });
  }
);
