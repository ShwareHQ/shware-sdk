import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Principal } from '../core/index';
import type { KVRepository } from '../session/types';
import { AuthenticationError } from './error';

/** Seconds a desktop sign-in code may be redeemed within. */
export const DESKTOP_CODE_TTL = 5 * 60;

interface DesktopCodeRecord {
  /** Who the web session that issued the code is signed in as. */
  principal: Principal;
  /** The S256 `code_challenge` the desktop sent; the verifier it redeems with must hash to it. */
  code_challenge: string;
}

/**
 * The single-use codes of the desktop sign-in handshake (RFC 8252 loopback + PKCE): a signed-in
 * web session issues one pinned to the desktop's `code_challenge`, the desktop redeems it with the
 * matching `code_verifier`, and nothing else ever travels over the loopback.
 */
export class DesktopCodes {
  private readonly kv: KVRepository;

  constructor(kv: KVRepository) {
    this.kv = kv;
  }

  private key(code: string) {
    return `desktop:code:${code}`;
  }

  async issue(principal: Principal, codeChallenge: string): Promise<string> {
    const code = randomUUID();
    const record: DesktopCodeRecord = { principal, code_challenge: codeChallenge };
    await this.kv.setItem(this.key(code), JSON.stringify(record), DESKTOP_CODE_TTL);
    return code;
  }

  /**
   * The principal a code was issued for, consuming the code; `INVALID_DESKTOP_CODE` for one
   * that is unknown, expired, already used, or whose verifier does not hash to its challenge. A
   * verifier mismatch does not burn the code: that would let an attacker who races a network
   * retry brick a legitimate exchange, and guessing the 256-bit verifier within the TTL is
   * infeasible.
   */
  async redeem(code: string, codeVerifier: string): Promise<Principal> {
    const key = this.key(code);
    const raw = await this.kv.getItem(key);
    if (typeof raw !== 'string') throw new AuthenticationError('INVALID_DESKTOP_CODE');
    let record: DesktopCodeRecord;
    try {
      record = JSON.parse(raw) as DesktopCodeRecord;
    } catch {
      await this.kv.removeItem(key);
      throw new AuthenticationError('INVALID_DESKTOP_CODE');
    }
    const computed = createHash('sha256').update(codeVerifier).digest();
    const stored = Buffer.from(record.code_challenge, 'base64url');
    if (stored.length !== computed.length || !timingSafeEqual(computed, stored)) {
      throw new AuthenticationError('INVALID_DESKTOP_CODE');
    }
    // Removed before the caller creates a session, so a concurrent duplicate exchange (a retry
    // after a timeout) sees the code as consumed even if the session save races it.
    await this.kv.removeItem(key);
    return record.principal;
  }
}
