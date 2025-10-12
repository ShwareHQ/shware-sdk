import { base62 } from '../base62';

describe('base62', () => {
  it('should encode', () => {
    const buffer = Buffer.from([1]);
    const encoded = base62.encode(buffer);
    expect(encoded).toEqual('1');
  });

  it('should decode', () => {
    const encoded = '1';
    const decoded = base62.decode(encoded);
    expect(decoded).toEqual(Buffer.from([1]));
  });

  it('should encode and decode', () => {
    const buffer = Buffer.from('hello', 'utf-8');
    const encoded = base62.encode(buffer);
    const decoded = base62.decode(encoded, buffer.length);
    expect(decoded).toEqual(buffer);
  });

  it('should encode and decode with leading zeros', () => {
    const buffer = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const encoded = base62.encode(buffer);
    const decoded = base62.decode(encoded, buffer.length);
    expect(decoded).toEqual(buffer);
  });
});
