import { pushTemplate } from '@shware/workflow';
import * as z from 'zod/mini';

/**
 * Push content is a function of the parsed props: the notification the OS
 * renders inside its own chrome, built from what the workflow passes.
 */
export default pushTemplate({
  id: 'reengage_comeback_push',
  topic: 'product_updates',
  title: 'Re-engagement · Come back',
  description: 'First touch for dormant users, sent before the win-back emails.',
  props: z.strictObject({ name: z.string() }),
  preview: { name: 'Ada' },
  content: ({ name }) => ({
    title: `We saved your spot, ${name}`,
    body: 'Your workspace is exactly where you left it — new templates landed while you were away.',
  }),
});
