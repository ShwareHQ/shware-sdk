import { randomInt, timingSafeEqual } from 'node:crypto';
import type { KVRepository } from '../session/types';
import { AuthenticationError } from './error';
import { resourceExhausted, unavailable } from './respond';

/** Seconds an email verification code, and its attempt counter, stay valid. */
export const EMAIL_VERIFICATION_CODE_TTL = 10 * 60;

export type EmailSender = (data: { email: string; verificationCode: string }) => Promise<void>;

/**
 * The six-digit codes mailed to prove an address, in the KV store: one pending code per email,
 * its guess counter, and the resend cooldown. `send` and `verify` are the whole protocol, so the
 * login route and a host flow that only needs proof of the address (verifying or changing a
 * signed-in user's email) share it.
 */
export class EmailVerificationCodes {
  private readonly kv: KVRepository;
  private readonly maxAttempts: number;
  private readonly resendCooldown: number;

  constructor(kv: KVRepository, options: { maxAttempts: number; resendCooldown: number }) {
    this.kv = kv;
    this.maxAttempts = options.maxAttempts;
    this.resendCooldown = options.resendCooldown;
  }

  private codeKey(email: string) {
    return `email:verification:${email}`;
  }

  private attemptsKey(email: string) {
    return `email:verification-attempts:${email}`;
  }

  private cooldownKey(email: string) {
    return `email:verification-cooldown:${email}`;
  }

  /**
   * Mails a fresh code, at most once per `resendCooldown`. The cooldown is claimed before sending,
   * so of concurrent requests exactly one sends. A failed delivery releases it again: no code was
   * stored, so an immediate retry gains an attacker nothing, while keeping it would lock the user
   * out of signing in for the whole cooldown.
   */
  async send(email: string, sender: EmailSender): Promise<void> {
    const cooldownKey = this.cooldownKey(email);
    if ((await this.kv.increment(cooldownKey, this.resendCooldown)) > 1) {
      throw resourceExhausted('VERIFICATION_CODE_RESEND_TOO_SOON', 'A code was sent recently');
    }
    const verificationCode = randomInt(1_000_000).toString().padStart(6, '0');
    try {
      // Sent before it is stored, so a failed delivery leaves the previous code usable.
      await sender({ email, verificationCode });
    } catch (error) {
      console.error('Failed to send email verification code', error);
      await this.kv.removeItem(cooldownKey);
      throw unavailable('EMAIL_DELIVERY_FAILED', 'The verification email could not be sent');
    }
    // The new code gets the full attempt budget; the cooldown bounds how often that happens.
    // Reset before storing, so every comparison against the new code is counted.
    await this.kv.removeItem(this.attemptsKey(email));
    await this.kv.setItem(this.codeKey(email), verificationCode, EMAIL_VERIFICATION_CODE_TTL);
  }

  /**
   * Spends the pending code if `verificationCode` is it; otherwise throws `AuthenticationError`:
   * `INVALID_VERIFICATION_CODE` (wrong, or none pending), or `VERIFICATION_CODE_ATTEMPTS_EXCEEDED`
   * once more than `maxAttempts` guesses were made, which discards the code.
   */
  async verify(email: string, verificationCode: string): Promise<void> {
    const codeKey = this.codeKey(email);
    const attemptsKey = this.attemptsKey(email);
    const stored = await this.kv.getItem(codeKey);
    if (typeof stored !== 'string') throw new AuthenticationError('INVALID_VERIFICATION_CODE');

    // Count the attempt before comparing: the atomic increment hands every request, parallel ones
    // included, a distinct count, so at most maxAttempts comparisons are ever made against a code.
    const attempts = await this.kv.increment(attemptsKey, EMAIL_VERIFICATION_CODE_TTL);
    if (attempts > this.maxAttempts) {
      // Only the code is discarded. The counter stays until it expires (or a new code is sent):
      // removing it would hand requests that already read the code a fresh budget.
      await this.kv.removeItem(codeKey);
      throw new AuthenticationError('VERIFICATION_CODE_ATTEMPTS_EXCEEDED');
    }
    if (
      stored.length !== verificationCode.length ||
      !timingSafeEqual(Buffer.from(stored), Buffer.from(verificationCode))
    ) {
      throw new AuthenticationError('INVALID_VERIFICATION_CODE');
    }
    await this.kv.removeItem(codeKey);
    await this.kv.removeItem(attemptsKey);
  }
}
