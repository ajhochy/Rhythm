import { existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const sourceWebDist = resolve(import.meta.dirname, '../../web/dist');
const packagedWebDist = resolve(import.meta.dirname, '../web/dist');
export const webDist = existsSync(sourceWebDist) ? sourceWebDist : packagedWebDist;

/** @param {{ host: string, method: string, pathname: string }} request */
export function validateRequest({ host, method, pathname }) {
  if (host !== 'app' || method !== 'GET' || !pathname?.startsWith('/')) return false;
  try {
    const decoded = decodeURIComponent(pathname);
    return !decoded.includes('\\') && !decoded.split('/').includes('..') && !decoded.includes('\0');
  } catch {
    return false;
  }
}

/** @param {string} url */
export function validateDeepLink(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'rhythm:' && validateRequest({
      host: parsed.hostname,
      method: 'GET',
      pathname: parsed.pathname,
    });
  } catch {
    return false;
  }
}

/**
 * @param {unknown[]} argv
 * @returns {string | null}
 */
export function deepLinkFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const argument of argv) {
    if (typeof argument === 'string' && validateDeepLink(argument)) return argument;
  }
  return null;
}

/** @param {string} pathname */
export function resolveAsset(pathname) {
  if (!validateRequest({ host: 'app', method: 'GET', pathname })) return null;
  const file = resolve(webDist, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(`${webDist}${sep}`) || !existsSync(file)) return null;
  return statSync(file).isFile() ? file : null;
}

/**
 * The one gate for handing a URL to the OS browser (IPC, window.open, link clicks, navigation).
 * Returns the canonical href for a credential-free http(s) URL, otherwise null.
 * @param {unknown} value
 */
export function externalHttpUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || value.length > 4096 || /[\p{Cc}\p{Cf}\s]/u.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  return url.href;
}

/**
 * Electron exposes no user-gesture flag on window-open or will-navigate, so a runaway page
 * script is bounded by count instead: at most `max` opens per sliding `windowMs`.
 * @param {number} max @param {number} windowMs @param {() => number} [now]
 */
export function createExternalOpenLimiter(max, windowMs, now = Date.now) {
  /** @type {number[]} */
  const recent = [];
  return () => {
    const t = now();
    while (recent.length && t - recent[0] >= windowMs) recent.shift();
    if (recent.length >= max) return false;
    recent.push(t);
    return true;
  };
}
