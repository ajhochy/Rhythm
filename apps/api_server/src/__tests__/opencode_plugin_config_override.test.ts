/**
 * Regression guard: plugin reconciliation writes the configured opencode.json,
 * never the user's real one.
 *
 * ensureRequiredPlugins() defaulted to a hard-coded ~/.config/opencode path and
 * ignored RHYTHM_OPENCODE_CONFIG_PATH, which every other writer honors. Live
 * 0.18.71 qualification (config pointed at its fixture) rewrote the user's real
 * plugin list to paths inside the qualification bundle.
 */
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { ensureRequiredPlugins } from '../services/opencode_plugin_config';

afterEach(() => { vi.unstubAllEnvs(); });

it('ensureRequiredPlugins() writes the RHYTHM_OPENCODE_CONFIG_PATH file', () => {
  const target = join(mkdtempSync(join(tmpdir(), 'oc-config-')), 'opencode.json');
  vi.stubEnv('RHYTHM_OPENCODE_CONFIG_PATH', target);
  ensureRequiredPlugins();
  expect(existsSync(target)).toBe(true);
  expect(Array.isArray(JSON.parse(readFileSync(target, 'utf8')).plugin)).toBe(true);
});
