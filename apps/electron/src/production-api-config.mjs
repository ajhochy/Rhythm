import { readFileSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** @param {unknown} value */
export function normalizeProductionApiBase(value) {
  try {
    const url = new URL(typeof value === 'string' ? value.trim() : '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('Production API URL must be HTTP(S) without credentials, query, or fragment');
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
