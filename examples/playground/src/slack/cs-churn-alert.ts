/**
 * Internal hand-off to the customer success team. Chat content is data, the
 * same as a push: a bold first line and a body, both string templates whose
 * `{prop}` placeholders the engine fills at send time.
 */

export const name = 'CS · Churn alert';
export const description =
  'Posted when a business customer cancels, so a human reaches out before any automation does.';

export const sender = 'Lifecycle Bot';
export const to = '#customer-success';

export const title = 'Business cancellation — {plan} plan';
export const body =
  'A business customer just cancelled. They are held out of the automated win-back flow, so this thread is the only follow-up they will get. Claim it with a ✋.';
