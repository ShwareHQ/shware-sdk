import { describe, expect, it } from 'vitest';
import { parse, safeParse } from 'zod/mini';
import { createFeedbackSchema } from './index';

const body = { name: 'Ada', email: 'ada@example.com', message: 'hi', turnstileToken: 'tok' };

describe('createFeedbackSchema', () => {
  it('accepts a body with a turnstile token and trims and lower-cases the email', () => {
    const dto = parse(createFeedbackSchema, { ...body, email: '  Ada@Example.COM ' });
    expect(dto.email).toBe('ada@example.com');
    expect(dto.turnstileToken).toBe('tok');
  });

  it('still rejects what is not an email', () => {
    expect(safeParse(createFeedbackSchema, { ...body, email: 'not an email' }).success).toBe(false);
  });

  it('rejects a body without a turnstile token', () => {
    const { turnstileToken: _, ...withoutToken } = body;
    expect(safeParse(createFeedbackSchema, withoutToken).success).toBe(false);
  });

  it('rejects an empty turnstile token', () => {
    expect(safeParse(createFeedbackSchema, { ...body, turnstileToken: '' }).success).toBe(false);
  });

  it('rejects a turnstile token over 2048 characters', () => {
    expect(
      safeParse(createFeedbackSchema, { ...body, turnstileToken: 'a'.repeat(2048) }).success
    ).toBe(true);
    expect(
      safeParse(createFeedbackSchema, { ...body, turnstileToken: 'a'.repeat(2049) }).success
    ).toBe(false);
  });
});
