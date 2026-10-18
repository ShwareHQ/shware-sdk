import { emailTemplate } from '@shware/workflow';
import { createElement } from 'react';
import * as z from 'zod/mini';

/** The project's email registry, in a module of its own — what the browser imports. */
export const email = {
  // A JavaScript name of its own: the template is `welcome` by its id
  welcomeEmail: emailTemplate({
    id: 'welcome',
    title: 'Welcome',
    props: z.strictObject({}),
    subject: 'Welcome aboard',
    preview: {},
    component: () => createElement('p', null, 'Welcome'),
  }),
};
