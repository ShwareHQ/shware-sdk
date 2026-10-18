import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';

export default emailTemplate({
  id: 'onboarding_pro_tips',
  title: 'Onboarding · Pro tips',
  description: 'For users already active: the shortcuts that separate daily drivers from visitors.',
  props: z.strictObject({}),
  subject: 'Four shortcuts our heaviest users live in',
  preview: {},
  component: () => (
    <Message
      preheader="Command palette, backlinks, snippets, offline"
      heading="Four shortcuts worth learning"
      body={
        'The command palette opens everything, backlinks find what you forgot you wrote, snippets expand as you type, and offline mode keeps writing on a plane.'
      }
      cta={{ label: 'See all shortcuts', href: 'https://example.com/docs/shortcuts' }}
    />
  ),
});
