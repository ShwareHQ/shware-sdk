import { emailTemplate, pushTemplate } from '@shware/workflow';
import { createElement } from 'react';
import * as z from 'zod/mini';

/** A small project's one template module: both channels in one exported registry, no index files. */
export const registry = {
  email: {
    welcome: emailTemplate({
      id: 'welcome',
      transactional: true,
      from: 'hello@acme.test',
      title: 'Welcome',
      props: z.strictObject({}),
      subject: 'Welcome aboard',
      preview: {},
      component: () => createElement('p', null, 'Welcome'),
    }),
  },
  push: {
    nudge: pushTemplate({
      id: 'nudge',
      transactional: true,
      title: 'Nudge',
      props: z.strictObject({}),
      preview: {},
      content: () => ({ title: 'Come back', body: 'Your streak is waiting' }),
    }),
  },
};
