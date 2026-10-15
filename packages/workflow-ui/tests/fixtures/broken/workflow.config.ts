import { defineConfig, template, trigger, workflow } from '@shware/workflow';
import { contract } from '../contract';

const onboarding = workflow({ id: 'onboarding', trigger: trigger.event(contract.events.sign_up) })
  .delay('1 day')
  .email(template.email('never_written'));

/** References a template no registry has: the compile must refuse it, naming workflow and node. */
export default defineConfig({ workflows: [onboarding], templates: { email: {} } });
