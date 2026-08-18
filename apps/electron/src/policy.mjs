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
