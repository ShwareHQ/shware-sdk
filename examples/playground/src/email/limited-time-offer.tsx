import { emailTemplate } from '@shware/workflow';
import * as z from 'zod/mini';
import { Cta, Heading, Paragraph, Shell } from './layout';

export default emailTemplate({
  title: 'Cart Recovery · Last touch',
  props: z.strictObject({ coupon: z.string(), expiresIn: z.string() }),
  subject: 'Your discount code is inside — it expires soon',
  preview: { coupon: '15OFF', expiresIn: '48 hours' },
  component: ({ coupon, expiresIn }) => (
    <Shell preheader="Claim your exclusive discount">
      <Heading>Claim your exclusive discount</Heading>
      <Paragraph>
        Use code <strong className="text-ink font-mono">{coupon}</strong> at checkout. It expires in{' '}
        {expiresIn} and this is the last email we&apos;ll send about it.
      </Paragraph>
      <Cta href="https://example.com/checkout">Apply {coupon}</Cta>
    </Shell>
  ),
});
