import { extractIpAddress } from '../utils/ip';

describe('extractIpAddress', () => {
  it('should extract the ipv4 address from the request', () => {
    expect(extractIpAddress('127.0.0.1')).toBe('127.0.0.1');
    expect(extractIpAddress('192.168.0.1')).toBe('192.168.0.1');
    expect(extractIpAddress('127.0.0.1:8080')).toBe('127.0.0.1');
    expect(extractIpAddress('192.168.0.1:8080')).toBe('192.168.0.1');
    expect(extractIpAddress('127.0.0.1:8080/path')).toBe('127.0.0.1');
  });

  it('should extract the ipv6 address from the request', () => {
    expect(extractIpAddress('::1')).toBe('::1');
    expect(extractIpAddress('[::1]:8080')).toBe('::1');

    expect(extractIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(
      '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
    );
    expect(extractIpAddress('[2001:0db8:85a3:0000:0000:8a2e:0370:7334]:80')).toBe(
      '2001:db8:85a3::8a2e:370:7334' // remove leading zeros
    );
    expect(extractIpAddress('[2001:0db8:85a3:0000:0000:8a2e:0370:7334]:80/path')).toBe(
      '2001:db8:85a3::8a2e:370:7334' // remove leading zeros
    );
  });

  it('should return null if the ip address is not valid', () => {
    expect(extractIpAddress(null)).toBeNull();
    expect(extractIpAddress(undefined)).toBeNull();
    expect(extractIpAddress('invalid')).toBeNull();
    expect(extractIpAddress('example.com')).toBeNull();
  });
});
