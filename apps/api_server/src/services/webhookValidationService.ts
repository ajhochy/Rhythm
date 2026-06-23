/**
 * Webhook SSRF Protection
 *
 * Translates Odysseus `src/webhook_manager.py:_is_private_url()` to TypeScript.
 * Blocks registration of webhook endpoints that point to private / loopback
 * addresses (SSRF defense). Re-checked at delivery time via `isDeliverySafe()`.
 *
 * Covered threat: attacker registers a webhook pointing to an internal service
 * (e.g. 169.254.169.254 for cloud metadata, 127.0.0.1:5432 for Postgres).
 *
 * NOT covered (by design): inbound webhook payloads (no user-controlled URL
 * is ever fetched on behalf of an inbound request).
 */

import dns from 'node:dns/promises';
import net from 'node:net';

// RFC1918 + loopback + link-local + doc ranges
const PRIVATE_CIDR_V4: Array<[number, number, number]> = [
  // [base, mask, prefix] stored as 32-bit integers for fast comparison
  [ip4ToInt('10.0.0.0'),      ip4ToInt('255.0.0.0'),     8],
  [ip4ToInt('172.16.0.0'),    ip4ToInt('255.240.0.0'),   12],
  [ip4ToInt('192.168.0.0'),   ip4ToInt('255.255.0.0'),   16],
  [ip4ToInt('127.0.0.0'),     ip4ToInt('255.0.0.0'),      8],
  [ip4ToInt('169.254.0.0'),   ip4ToInt('255.255.0.0'),   16],  // link-local
  [ip4ToInt('100.64.0.0'),    ip4ToInt('255.192.0.0'),   10],  // CGNAT
  [ip4ToInt('192.0.2.0'),     ip4ToInt('255.255.255.0'), 24],  // TEST-NET-1
  [ip4ToInt('198.51.100.0'),  ip4ToInt('255.255.255.0'), 24],  // TEST-NET-2
  [ip4ToInt('203.0.113.0'),   ip4ToInt('255.255.255.0'), 24],  // TEST-NET-3
  [ip4ToInt('0.0.0.0'),       ip4ToInt('255.0.0.0'),      8],  // this network
  [ip4ToInt('255.255.255.255'), 0xFFFFFFFF,               32], // broadcast
];

function ip4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;
  const ipInt = ip4ToInt(ip);
  for (const [base, mask] of PRIVATE_CIDR_V4) {
    if ((ipInt & mask) === base) return true;
  }
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  if (!net.isIPv6(ip)) return false;
  // Loopback
  if (ip === '::1') return true;
  // Unspecified
  if (ip === '::') return true;
  // ULA (fc00::/7)
  const first16 = parseInt(ip.split(':')[0] ?? '', 16);
  if ((first16 & 0xfe00) === 0xfc00) return true;
  // Link-local (fe80::/10)
  if ((first16 & 0xffc0) === 0xfe80) return true;
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) {
    // IPv4-mapped IPv6 e.g. ::ffff:192.168.1.1
    const ipv4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (ipv4Mapped) return isPrivateIpv4(ipv4Mapped[1]);
    return isPrivateIpv6(ip);
  }
  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost', '0.0.0.0', '0', 'metadata.google.internal',
  'metadata', '169.254.169.254',
]);

const BLOCKED_SUFFIXES = ['.local', '.internal', '.lan', '.intranet', '.localhost'];

/**
 * Returns true when the URL is safe to target as an outbound webhook
 * (i.e., the hostname resolves to a public IP).
 *
 * Resolves DNS so attackers can't hide an internal IP behind a CNAME.
 * Re-checked at delivery time to guard against DNS rebinding.
 */
export async function isWebhookUrlSafe(rawUrl: string): Promise<{ safe: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { safe: false, reason: 'Only http:// and https:// are supported' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\[|\]/g, ''); // strip IPv6 brackets

  // Block known bad hostnames immediately
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: `Hostname "${hostname}" is not allowed (private)` };
  }

  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { safe: false, reason: `Hostname suffix "${suffix}" is not allowed (private)` };
    }
  }

  // IP literal check (no DNS needed)
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return { safe: false, reason: `IP address "${hostname}" is in a private range` };
    }
    return { safe: true };
  }

  // DNS resolution — block if ANY A/AAAA resolves to a private address
  try {
    const addrs = await dns.resolve(hostname);
    for (const addr of addrs) {
      if (isPrivateIp(addr)) {
        return { safe: false, reason: `Hostname resolves to private IP "${addr}"` };
      }
    }
  } catch (err) {
    // DNS failure — fail closed (don't allow unresolvable hostnames)
    return { safe: false, reason: `DNS resolution failed: ${String(err)}` };
  }

  return { safe: true };
}

/**
 * Quick synchronous check for known-bad IP literals and hostnames.
 * Used as a fast pre-check before the async DNS lookup.
 */
export function isWebhookUrlQuickReject(rawUrl: string): { rejected: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { rejected: true, reason: 'Invalid URL' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\[|\]/g, '');

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { rejected: true, reason: `Hostname "${hostname}" is not allowed` };
  }
  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { rejected: true, reason: `Hostname suffix "${suffix}" is not allowed` };
    }
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    return { rejected: true, reason: `IP "${hostname}" is in a private range` };
  }

  return { rejected: false };
}
