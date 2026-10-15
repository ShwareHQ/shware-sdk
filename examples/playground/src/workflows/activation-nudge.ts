import { trigger, workflow } from '@shware/workflow';
import { t } from '../templates';
import { e } from './schema';
import { activated } from './segments';

/**
 * A recurring nudge. There is no loop inside the tree — a trailing,
 * self-triggering sendEvent is the correct shape (an event edge between
 * workflows). The goal guarantees termination and counts the conversion, with
 * a trigger rate limit as the backstop.
 * The goal is written in full form here — a 30-day attribution window and
 * exit-on-match — even though both are the defaults, to show the shape.
 */
export const activationNudge = workflow({
  id: 'activation_nudge',
  name: 'Activation Nudge',
  trigger: trigger.event(e.activation_nudge_due),
  goal: { condition: activated, within: '30 days', exitOnMatch: true },
})
  .email(t.email.onboarding_getting_started)
  .delay('8 days')
  .sendEvent(e.activation_nudge_due);
