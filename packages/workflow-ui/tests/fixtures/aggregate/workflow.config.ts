import { defineConfig, trigger, workflow } from '@shware/workflow';
import { contract } from '../contract';
import { registry, t } from './src/templates';

const onboarding = workflow({ id: 'onboarding', trigger: trigger.event(contract.events.sign_up) })
  .email(t.email.welcome)
  .push(t.push.nudge);

export default defineConfig({ workflows: [onboarding], templates: registry });
