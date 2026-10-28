import * as z from 'zod/mini';
import { pushTemplate } from '../workflows/schema';

/**
 * The lock-screen half of U1: sent in the same step as the upgrade-recovery
 * email, so a subscriber who never opens the inbox still sees the nudge.
 */
export default pushTemplate({
  id: 'checkout_reminder_push',
  topic: 'offers',
  title: 'Checkout · Reminder',
  description: 'Lands with the upgrade-recovery email an hour after an abandoned checkout.',
  props: z.strictObject({}),
  preview: {},
  content: () => ({
    title: 'Your upgrade is one tap away',
    body: 'Pick up where you left off — your plan is saved at checkout. Nothing has been charged.',
  }),
});
