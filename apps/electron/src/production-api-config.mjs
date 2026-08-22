import { readFileSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** @param {string} hostname */
function isLoopbackHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  const mapped = host.match(/^::ffff:(?:(\d{1,3})(?:\.\d{1,3}){3}|([0-9a-f]{1,4}):[0-9a-f]{1,4})$/i);
  if (!mapped) return false;
  return mapped[1] === '127' || (mapped[2] ? (Number.parseInt(mapped[2], 16) >> 8) === 127 : false);
}

/** @param {unknown} value */
export function normalizeProductionApiBase(value) {
  try {
    const url = new URL(typeof value === 'string' ? value.trim() : '');
    if (url.protocol !== 'https:' || isLoopbackHostname(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('Production API URL must be remote HTTPS without credentials, query, or fragment');
  }
}

/** @param {{ configPath: string, defaultBase: string, env: Record<string, string | undefined> }} options */
export function createProductionApiConfig({ configPath, defaultBase, env }) {
  const load = () => {
    if (env.RHYTHM_PRODUCTION_API_URL) return normalizeProductionApiBase(env.RHYTHM_PRODUCTION_API_URL);
    try { return normalizeProductionApiBase(JSON.parse(readFileSync(configPath, 'utf8')).serverUrl); }
    catch { return normalizeProductionApiBase(defaultBase); }
  };
  /** @param {unknown} value */
  const save = async (value) => {
    const serverUrl = normalizeProductionApiBase(value);
    const temporaryPath = `${configPath}.tmp`;
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify({ serverUrl }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, configPath);
    await chmod(configPath, 0o600);
    return serverUrl;
  };
  return { load, save };
}

/** @param {{ allowedSender: () => unknown, save: (value: unknown) => Promise<unknown> | unknown }} options */
export function createProductionApiSetHandler({ allowedSender, save }) {
  /** @param {{ sender: unknown }} event @param {unknown} value */
  const handler = async (event, value) => {
    if (event.sender !== allowedSender()) throw new Error('Production API URL update denied');
    return save(normalizeProductionApiBase(value));
  };
  return handler;
}
