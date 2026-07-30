import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  ensureRequiredPlugins,
  rhythmAnthropicPluginPath,
  rhythmSessionContextPluginPath,
  rhythmTelemetryPluginPath,
} from '../services/opencode_plugin_config';

function requiredPath(value: string | null): string {
  if (!value) throw new Error('Expected vendored plugin fixture to exist');
  return value;
}

describe('R6 managed OpenCode plugin identity and cleanup contract', () => {
  let tempRoot: string;
  let configPath: string;
  const originalDisabled = process.env.RHYTHM_TOOL_TELEMETRY_DISABLED;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'r6-plugin-identity-'));
    configPath = join(tempRoot, 'config', 'opencode.json');
    delete process.env.RHYTHM_TOOL_TELEMETRY_DISABLED;
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
    if (originalDisabled === undefined) {
      delete process.env.RHYTHM_TOOL_TELEMETRY_DISABLED;
    } else {
      process.env.RHYTHM_TOOL_TELEMETRY_DISABLED = originalDisabled;
    }
  });

  function writePlugins(plugin: string[]): void {
    mkdirSync(join(tempRoot, 'config'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ plugin }, null, 2));
  }

  function readPlugins(): string[] {
    return (JSON.parse(readFileSync(configPath, 'utf8')) as { plugin: string[] }).plugin;
  }

  it('issue-0-c1: canonicalizes a managed plugin symlink and checkout path to the current entry', () => {
    // Regression caught: exact-string comparison keeps a symlink/old checkout
    // beside the current telemetry path, so both plugin modules emit an event.
    const telemetryPath = requiredPath(rhythmTelemetryPluginPath());
    const symlinkPath = join(tempRoot, 'telemetry-from-other-checkout');
    symlinkSync(telemetryPath, symlinkPath, 'dir');
    const alternateCheckoutPath = join(
      tempRoot,
      'old-worktree',
      'apps',
      'api_server',
      'opencode_plugins',
      'rhythm-telemetry',
    );
    mkdirSync(alternateCheckoutPath, { recursive: true });
    writeFileSync(
      join(alternateCheckoutPath, 'package.json'),
      JSON.stringify({ name: 'rhythm-telemetry' }),
    );
    writePlugins([symlinkPath, alternateCheckoutPath]);

    expect(ensureRequiredPlugins(configPath)).toBe(true);

    const plugins = readPlugins();
    expect(plugins).not.toContain(symlinkPath);
    expect(plugins).not.toContain(alternateCheckoutPath);
    expect(plugins.filter((entry) => entry === telemetryPath)).toHaveLength(1);
  });

  it('issue-0-c2: removes nonexistent managed worktree paths for every Rhythm plugin', () => {
    // Regression caught: stale worktree paths survive because they differ from
    // the current checkout string and cannot be realpathed after deletion.
    const stalePaths = [
      'rhythm-anthropic-accounts',
      'rhythm-telemetry',
      'rhythm-session-context',
    ].map((name) =>
      join(
        tempRoot,
        'deleted-worktree',
        'apps',
        'api_server',
        'opencode_plugins',
        name,
      ),
    );
    writePlugins([...stalePaths, 'third-party-package']);

    expect(ensureRequiredPlugins(configPath)).toBe(true);

    const plugins = readPlugins();
    for (const stalePath of stalePaths) {
      expect(plugins).not.toContain(stalePath);
    }
    expect(plugins).toContain('third-party-package');
  });

  it('issue-0-c3: preserves a third-party plugin whose directory name overlaps telemetry', () => {
    // Regression caught: substring matching treats any directory named
    // rhythm-telemetry as managed and deletes a user's unrelated local plugin,
    // while an unmarked realpath alias of Rhythm's plugin can evade cleanup.
    const managedTelemetryPath = requiredPath(rhythmTelemetryPluginPath());
    const managedAliasPath = join(tempRoot, 'user-plugins', 'managed-alias');
    const thirdPartyPath = join(tempRoot, 'user-plugins', 'rhythm-telemetry');
    mkdirSync(thirdPartyPath, { recursive: true });
    symlinkSync(managedTelemetryPath, managedAliasPath, 'dir');
    writeFileSync(
      join(thirdPartyPath, 'package.json'),
      JSON.stringify({ name: 'user-authored-telemetry-adapter' }),
    );
    writePlugins([managedAliasPath, thirdPartyPath, 'another-user-plugin']);
    process.env.RHYTHM_TOOL_TELEMETRY_DISABLED = '1';

    expect(ensureRequiredPlugins(configPath)).toBe(true);

    const plugins = readPlugins();
    expect(plugins).not.toContain(managedAliasPath);
    expect(plugins).toEqual(
      expect.arrayContaining([thirdPartyPath, 'another-user-plugin']),
    );
  });

  it('issue-0-c4: repeated startup cleanup converges byte-for-byte', () => {
    // Regression caught: path-dependent cleanup can swap between copies or
    // rewrite the file on every startup instead of reaching a fixed point.
    const staleTelemetryPath = join(
      tempRoot,
      'old-worktree',
      'apps',
      'api_server',
      'opencode_plugins',
      'rhythm-telemetry',
    );
    const staleSessionPath = join(
      tempRoot,
      'old-worktree',
      'apps',
      'api_server',
      'opencode_plugins',
      'rhythm-session-context',
    );
    writePlugins([staleTelemetryPath, staleSessionPath, 'user-plugin']);

    expect(ensureRequiredPlugins(configPath)).toBe(true);
    const afterFirstStartup = readFileSync(configPath, 'utf8');
    expect(readPlugins()).not.toContain(staleTelemetryPath);
    expect(readPlugins()).not.toContain(staleSessionPath);

    expect(ensureRequiredPlugins(configPath)).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe(afterFirstStartup);
  });

  it('issue-0-c5: event seam converges multiple telemetry copies to one recorder entry', () => {
    // Regression caught: each distinct configured path loads another plugin
    // module, so one logical tool call produces one POST per surviving entry.
    const telemetryPath = requiredPath(rhythmTelemetryPluginPath());
    const configuredCopies = ['worktree-a', 'worktree-b', 'worktree-c'].map(
      (worktree) =>
        join(
          tempRoot,
          worktree,
          'apps',
          'api_server',
          'opencode_plugins',
          'rhythm-telemetry',
        ),
    );
    writePlugins([...configuredCopies, telemetryPath]);

    expect(ensureRequiredPlugins(configPath)).toBe(true);

    const telemetryEntries = readPlugins().filter(
      (entry) => basename(entry) === 'rhythm-telemetry',
    );
    expect(telemetryEntries).toEqual([telemetryPath]);
    expect(readPlugins()).toContain(requiredPath(rhythmAnthropicPluginPath()));
    expect(readPlugins()).toContain(
      requiredPath(rhythmSessionContextPluginPath()),
    );
  });
});
