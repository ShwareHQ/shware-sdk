export const base62 = {
  encode: (buffer: Buffer): string => {
    const base = 62n;
    const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let leadingZeros = 0;
    for (const byte of buffer) {
      if (byte === 0) leadingZeros++;
      else break;
    }

    let num = BigInt('0x' + buffer.toString('hex'));
    if (num === 0n) return '0'.repeat(buffer.length);

    const chars: string[] = [];
    while (num > 0n) {
      const remainder = num % base;
      chars.push(charset[Number(remainder)]!);
      num /= base;
    }

    return '0'.repeat(leadingZeros) + chars.reverse().join('');
  },
  decode: (string: string, expectedLength?: number): Buffer => {
    const base = 62n;
    const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    let leadingZeros = 0;
    for (const ch of string) {
      if (ch === '0') leadingZeros++;
      else break;
    }

    if (leadingZeros === string.length) {
      return Buffer.alloc(expectedLength ?? leadingZeros);
    }

    let num = 0n;
    for (let i = leadingZeros; i < string.length; i++) {
      const ch = string[i];
      const idx = charset.indexOf(ch);
      if (idx === -1) {
        throw new Error(`Invalid base62 character: ${ch}`);
      }
      num = num * base + BigInt(idx);
    }

    let hex = num.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    let buf = Buffer.from(hex, 'hex');

    if (leadingZeros > 0) {
      buf = Buffer.concat([Buffer.alloc(leadingZeros), buf]);
    }

    if (expectedLength !== undefined) {
      if (buf.length < expectedLength) {
        buf = Buffer.concat([Buffer.alloc(expectedLength - buf.length), buf]);
      } else if (buf.length > expectedLength) {
        buf = buf.subarray(buf.length - expectedLength);
      }
    }

    return buf;
  },
};
