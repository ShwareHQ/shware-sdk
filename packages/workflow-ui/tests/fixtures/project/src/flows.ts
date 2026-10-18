import { trigger, workflow } from '@shware/workflow';
import { contract } from '../../contract';
import { email } from './email';

export const onboarding = workflow({
  id: 'onboarding',
  name: 'Onboarding',
  trigger: trigger.event(contract.events.sign_up),
}).email(email.welcomeEmail);
