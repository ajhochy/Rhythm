import { readFileSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeRemoteProductionApiBase } from '../../shared/production-api-base.mjs';

/** @param {unknown} value */
export function normalizeProductionApiBase(value) {
  return normalizeRemoteProductionApiBase(value);
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
