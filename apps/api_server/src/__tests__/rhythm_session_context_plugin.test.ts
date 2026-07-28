import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ensureRequiredPlugins,
  rhythmSessionContextPluginPath,
} from '../services/opencode_plugin_config';

const PLUGIN_DIR = path.join(
  __dirname,
  '..',
  '..',
  'opencode_plugins',
  'rhythm-session-context',
);
const PLUGIN_INDEX = path.join(PLUGIN_DIR, 'index.js');

async function loadPlugin() {
  const mod = await import(`${PLUGIN_INDEX}?t=${Date.now()}-${Math.random()}`);
  return mod.default;
}

describe('rhythm-session-context plugin (#1192)', () => {
  it('overwrites the reserved remember argument from authoritative context', async () => {
    const plugin = await loadPlugin();
    const hooks = await plugin();
    const output = {
      args: {
        content: 'Remember this.',
        sdkSessionId: 'model-forged-session',
      },
    };

    await hooks['tool.execute.before'](
      {
        tool: 'rhythm_rhythm_remember_memory',
        sessionID: 'sdk-authoritative-session',
      },
      output,
    );

    expect(output.args.sdkSessionId).toBe('sdk-authoritative-session');
  });

  it('does not alter other tools or malformed hook payloads', async () => {
    const plugin = await loadPlugin();
    const hooks = await plugin();
    const output = { args: { sdkSessionId: 'caller-value' } };

    await hooks['tool.execute.before'](
      { tool: 'rhythm_rhythm_search_memory', sessionID: 'sdk-other' },
      output,
    );
    await expect(
      hooks['tool.execute.before'](
        { tool: 'rhythm_rhythm_remember_memory' },
        {},
      ),
    ).resolves.toBeUndefined();

    expect(output.args.sdkSessionId).toBe('caller-value');
  });

  it('is present and always registered idempotently in opencode.json', () => {
    expect(existsSync(PLUGIN_INDEX)).toBe(true);
    expect(rhythmSessionContextPluginPath()).toBe(PLUGIN_DIR);
    const configPath = path.join(
      mkdtempSync(path.join(tmpdir(), 'oc-session-context-')),
      'opencode.json',
    );

    expect(ensureRequiredPlugins(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      plugin: string[];
    };
    expect(parsed.plugin).toContain(PLUGIN_DIR);
    expect(ensureRequiredPlugins(configPath)).toBe(false);
  });
});
