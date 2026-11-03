import { readFileSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const PREFERENCE_KEY = 'manualWorkstreams';

/** @param {unknown} value */
export function parseManualWorkstreamsPreference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = /** @type {Record<string, unknown>} */ (value);
  return Object.keys(record).length === 1 && Object.hasOwn(record, PREFERENCE_KEY) && record[PREFERENCE_KEY] === true;
}

/** @param {{ configPath: string }} options */
export function createManualWorkstreamsPreference({ configPath }) {
  const load = () => {
    try { return parseManualWorkstreamsPreference(JSON.parse(readFileSync(configPath, 'utf8'))); }
    catch { return false; }
  };
  /** @param {unknown} value */
  const save = async (value) => {
    if (typeof value !== 'boolean') throw new Error('Invalid manual workstreams preference');
    const temporaryPath = `${configPath}.tmp`;
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify({ [PREFERENCE_KEY]: value }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, configPath);
    await chmod(configPath, 0o600);
    return value;
  };
  return { load, save };
}

/**
 * Converts a captured owned-launch receipt into renderer-safe status. It does
 * not infer flags for an adopted runtime and intentionally contains no path,
 * credential, or process information.
 * @param {{ configured: unknown, runtime?: { ownership?: unknown, owned?: unknown, manualWorkstreamsLaunch?: unknown } | null }} options
 */
export function manualWorkstreamsPreferenceStatus({ configured, runtime = null }) {
  const configuredValue = configured === true;
  const ownership = runtime?.ownership === 'electron' || runtime?.ownership === 'external'
    ? runtime.ownership
    : 'none';
  const noOwnedLaunch = () => ({
    configured: configuredValue,
    effective: {
      source: ownership === 'external' ? 'adopted_runtime' : 'not_launched',
      workstreamsEnabled: null,
      managedContextExports: null,
      enabled: null,
    },
    pendingRelaunch: true,
  });
  const launch = runtime?.owned === true && ownership === 'electron' && runtime?.manualWorkstreamsLaunch;
  if (!launch || typeof launch !== 'object' || Array.isArray(launch)) return noOwnedLaunch();
  const receipt = /** @type {{ configured?: unknown, source?: unknown, workstreamsEnabled?: unknown, managedContextExports?: unknown }} */ (launch);
  if (!['preference', 'environment_override'].includes(String(receipt.source))
    || typeof receipt.configured !== 'boolean'
    || typeof receipt.workstreamsEnabled !== 'boolean'
    || typeof receipt.managedContextExports !== 'boolean') return noOwnedLaunch();
  const workstreamsEnabled = receipt.workstreamsEnabled === true;
  const managedContextExports = receipt.managedContextExports === true;
  const source = /** @type {'preference' | 'environment_override'} */ (receipt.source);
  return {
    configured: configuredValue,
    effective: {
      source,
      workstreamsEnabled,
      managedContextExports,
      enabled: workstreamsEnabled && managedContextExports,
    },
    // An explicit process-environment override has precedence on every owned
    // launch. A relaunch cannot make this saved device preference take effect.
    pendingRelaunch: source === 'environment_override' ? false : receipt.configured !== configuredValue,
  };
}
