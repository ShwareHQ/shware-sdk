import { describe, expect, it } from 'vitest';
import { parse, safeParse } from 'zod/mini';
import { createFeedbackSchema } from './index';

describe('createFeedbackSchema', () => {
  it('trims and lower-cases the email before validating it', () => {
    const dto = parse(createFeedbackSchema, {
      name: 'Ada',
      email: '  Ada@Example.COM ',
      message: 'hi',
    });
    expect(dto.email).toBe('ada@example.com');
  });

  it('still rejects what is not an email', () => {
    expect(
      safeParse(createFeedbackSchema, { name: 'Ada', email: 'not an email', message: 'hi' }).success
    ).toBe(false);
  });
});
