import { z } from 'zod';

/**
 * Sender address validation, shared by every place that writes to the address
 * book. Two accepted shapes — a bare email, or a display-name form:
 *
 *   hello@acme.io
 *   Acme <hello@acme.io>
 */

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function isValidEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (EMAIL.test(trimmed)) return true;
  const named = /^(.+?)\s*<([^<>]+)>$/.exec(trimmed);
  return named !== null && named[1]?.trim() !== '' && EMAIL.test(named[2] ?? '');
}

/** react-hook-form schema for a single address field; the message is the caller's translation. */
export const addressSchema = (invalidMessage: string) =>
  z.object({
    address: z.string().trim().min(1, invalidMessage).refine(isValidEmailAddress, invalidMessage),
  });

export type AddressForm = { address: string };
