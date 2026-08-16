import { describe, expect, test } from 'vitest';
import { canonicalJSON, fullHash, semanticHash, sha256Hex, stripMeta } from '../src/hash';

describe('sha256Hex', () => {
  /*
   * FIPS 180-4 known-answer vectors. contentHash is a permanent contract
   * (it addresses stored versions and pins in-flight journeys), so these pin
   * the implementation, not just its behaviour.
   */
  test('matches the reference vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
    // Multi-byte UTF-8 goes through the byte path, not charCodeAt
    expect(sha256Hex('你好')).toBe(
      '670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e'
    );
  });

  test('covers block-boundary lengths (55/56/64 bytes)', () => {
    // 55 bytes: padding fits in one block; 56/64: padding spills into a second
    for (const length of [55, 56, 63, 64, 65]) {
      const input = 'a'.repeat(length);
      expect(sha256Hex(input)).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256Hex(input)).toBe(sha256Hex(input));
    }
  });
});

describe('semanticHash / fullHash', () => {
  test('are 128-bit truncations and deterministic', () => {
    expect(semanticHash({ a: 1 })).toMatch(/^[0-9a-f]{32}$/);
    expect(semanticHash({ a: 1 })).toBe(semanticHash({ a: 1 }));
  });

  test('key order does not matter (canonical JSON)', () => {
    expect(fullHash({ a: 1, b: 2 })).toBe(fullHash({ b: 2, a: 1 }));
    expect(canonicalJSON({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  test('meta / label / contentHash are excluded from semanticHash but not fullHash', () => {
    const bare = { type: 'exit', reason: 'done' };
    const decorated = {
      ...bare,
      label: 'Exit',
      meta: { loc: { file: 'x.ts', line: 1, column: 1 } },
      contentHash: 'deadbeef',
    };
    expect(semanticHash(decorated)).toBe(semanticHash(bare));
    expect(fullHash(decorated)).not.toBe(fullHash(bare));
    expect(stripMeta(decorated)).toEqual(bare);
  });
});
