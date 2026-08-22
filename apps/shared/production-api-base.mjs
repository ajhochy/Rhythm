/** @param {string} value */
function parseIpv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

/** @param {string} value */
function parseIpv6(value) {
  let host = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes('%')) return null;
  const pieces = host.split('::');
  if (pieces.length > 2) return null;
  const parseSide = (side) => side ? side.split(':').filter(Boolean) : [];
  const left = parseSide(pieces[0]);
  const right = parseSide(pieces[1] ?? '');
  const embedded = [...left, ...right].findIndex((part) => part.includes('.'));
  if (embedded >= 0) {
    const all = [...left, ...right];
    if (embedded !== all.length - 1) return null;
    const ipv4 = parseIpv4(all[embedded]);
    if (!ipv4) return null;
    const replacement = [((ipv4[0] << 8) | ipv4[1]).toString(16), ((ipv4[2] << 8) | ipv4[3]).toString(16)];
    if (embedded < left.length) left.splice(embedded, 1, ...replacement);
    else right.splice(embedded - left.length, 1, ...replacement);
  }
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) return null;
  return [...left, ...Array(Math.max(0, missing)).fill('0'), ...right].map((part) => Number.parseInt(part, 16));
}

/** @param {number[]} bytes */
function isLocalIpv4(bytes) {
  const [a, b] = bytes;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

/** @param {string} hostname */
export function isLocalOnlyHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'localhost.localdomain' || host.endsWith('.localdomain') || host.endsWith('.local')) return true;
  const ipv4 = parseIpv4(host);
  if (ipv4) return isLocalIpv4(ipv4);
  const words = host.includes(':') ? parseIpv6(host) : null;
  if (!words) return false;
  if (words.every((word) => word === 0)) return true;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;
  const first = words[0];
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00) return true;
  if (first === 0x2001 && words[1] === 0x0db8) return true;
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  if (mapped || compatible) {
    return isLocalIpv4([words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff]);
  }
  return false;
}

/** @param {unknown} value */
export function normalizeRemoteProductionApiBase(value) {
  try {
    const url = new URL(typeof value === 'string' ? value.trim() : '');
    if (url.protocol !== 'https:' || isLocalOnlyHostname(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('Production API URL must be remote HTTPS without credentials, query, or fragment');
  }
}
