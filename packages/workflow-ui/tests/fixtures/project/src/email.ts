import { emailTemplate } from '@shware/workflow';
import { createElement } from 'react';
import * as z from 'zod/mini';

/** The project's email registry, in a module of its own — what the browser imports. */
export const email = {
  welcome: emailTemplate({
    title: 'Welcome',
    props: z.strictObject({}),
    subject: 'Welcome aboard',
    preview: {},
    component: () => createElement('p', null, 'Welcome'),
  }),
};
