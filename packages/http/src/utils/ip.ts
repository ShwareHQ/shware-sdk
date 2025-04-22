import { isIPv4, isIPv6 } from 'net';

export function extractIpAddress(ip: string | undefined | null): string | null {
  if (!ip) return null;
  if (isIPv4(ip) || isIPv6(ip)) return ip;
  try {
    const url = new URL(`https://${ip}`);
    const hostname = url.hostname.replace('[', '').replace(']', '');
    if (isIPv4(hostname) || isIPv6(hostname)) return hostname;
    return null;
  } catch (_) {
    return null;
  }
}
