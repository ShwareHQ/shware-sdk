import { describe, expect, it } from 'vitest';
import { expanded, idOf } from '../expandable';

describe('idOf', () => {
  it('reads the id from a bare reference or an expanded object', () => {
    expect(idOf('in_1')).toBe('in_1');
    expect(idOf({ id: 'in_1' })).toBe('in_1');
    expect(idOf(null)).toBeNull();
    expect(idOf(undefined)).toBeNull();
  });
});

describe('expanded', () => {
  it('returns the expanded object, and null for no reference', () => {
    const invoice = { id: 'in_1' };
    expect(expanded(invoice, 'Invoice')).toBe(invoice);
    expect(expanded(null, 'Invoice')).toBeNull();
  });

  it('throws when the caller forgot to expand it', () => {
    expect(() => expanded('in_1', 'Invoice')).toThrow(
      'Invoice in_1 was retrieved without expanding it'
    );
  });
});
