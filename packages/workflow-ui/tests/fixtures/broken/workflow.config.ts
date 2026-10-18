import { defineConfig, emailTemplate, trigger, workflow } from '@shware/workflow';
import { createElement } from 'react';
import * as z from 'zod/mini';
import { contract } from '../contract';

const neverRegistered = emailTemplate({
  id: 'never_written',
  title: 'Never registered',
  props: z.strictObject({}),
  subject: 'Hi',
  preview: {},
  component: () => createElement('p', null, 'Hi'),
});

const onboarding = workflow({ id: 'onboarding', trigger: trigger.event(contract.events.sign_up) })
  .delay('1 day')
  .email(neverRegistered);

/** Sends a template no registry has: the compile must refuse it, naming workflow and node. */
export default defineConfig({ workflows: [onboarding], templates: { email: {} } });
