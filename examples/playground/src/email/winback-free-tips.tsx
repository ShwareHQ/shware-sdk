import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Message } from './layout';

export default emailTemplate({
  title: 'Winback · Free tips',
  description: 'For downgrades: make the free plan work well, and stay welcome.',
  props: z.strictObject({}),
  subject: 'Getting the most out of the free plan',
  preview: {},
  component: () => (
    <Message
      preheader="No upsell, just the limits worth knowing"
      heading="The free plan, used well"
      body={
        'Three collaborators, unlimited personal docs and the whole template library. Here is where the limits actually bite, so nothing surprises you.'
      }
      cta={{ label: 'Read the guide', href: 'https://example.com/docs/free-plan' }}
    />
  ),
});
