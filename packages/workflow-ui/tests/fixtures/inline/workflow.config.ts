import { defineConfig, emailTemplate } from '@shware/workflow';
import { createElement } from 'react';
import * as z from 'zod/mini';

/** The registry exists only inside the config: the studio cannot import it without the config. */
export default defineConfig({
  workflows: [],
  templates: {
    email: {
      welcome: emailTemplate({
        id: 'welcome',
        from: 'hello@acme.test',
        title: 'Welcome',
        props: z.strictObject({}),
        subject: 'Welcome',
        preview: {},
        component: () => createElement('p', null, 'Welcome'),
      }),
    },
  },
});
