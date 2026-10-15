import { trigger, workflow } from '@shware/workflow';
import { contract } from '../../contract';
import { t } from './templates';

export const onboarding = workflow({
  id: 'onboarding',
  name: 'Onboarding',
  trigger: trigger.event(contract.events.sign_up),
}).email(t.email.welcome);
