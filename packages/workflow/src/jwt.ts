import { Buffer } from 'node:buffer';

/**
 * The byte-level helpers the token signers share (`fcm.ts`, `apns.ts`, `webpush.ts`): JWT
 * base64url and PEM → DER for WebCrypto's `importKey('pkcs8', …)`.
 */

export const base64url = (bytes: Uint8Array | string): string =>
  Buffer.from(bytes).toString('base64url');

export function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Buffer.from(body, 'base64');
  return der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength);
}
