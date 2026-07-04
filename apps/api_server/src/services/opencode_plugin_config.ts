import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

/**
 * The SDK ships built-in loaders for `openrouter`, `openai`, `github-copilot`,
 * and `opencode`. Direct routing to `anthropic` and `google` requires
 * community plugins to be listed in `~/.config/opencode/opencode.json`'s
 * `plugin` array — opencode auto-installs npm names at runtime and also
 * accepts absolute paths to local plugin dirs (fork plugin/shared.ts).
 *
 * Anthropic routing uses the vendored `rhythm-anthropic-accounts` plugin
 * (apps/api_server/opencode_plugins/) — a modified opencode-claude-auth that
 * resolves the bearer token per request from the Rhythm accounts file and
 * fails over between accounts on quota exhaustion. See its VENDORED.md.
 */
const REQUIRED_PLUGINS = [
  'opencode-openai-codex-auth', // openai loader via ChatGPT Plus OAuth (Codex backend)
  'opencode-gemini-auth', // google loader via Google AI subscription
];

/** Replaced by the vendored rhythm-anthropic-accounts plugin — always removed. */
const LEGACY_PLUGINS = ['opencode-claude-auth'];

const OPENCODE_CONFIG_PATH = join(
  homedir(),
  '.config',
  'opencode',
  'opencode.json',
);

/**
 * Resolve the vendored anthropic plugin dir in both layouts:
 * dev (tsx runs from src/services) and packaged (dist/services, with
 * opencode_plugins copied as a sibling of dist by desktop_release.yml).
 */
export function rhythmAnthropicPluginPath(): string | null {
  const candidates = [
    join(__dirname, '..', '..', 'opencode_plugins', 'rhythm-anthropic-accounts'),
    join(__dirname, '..', 'opencode_plugins', 'rhythm-anthropic-accounts'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Idempotently ensures the required community auth plugins are listed in
 * opencode.json, swapping the legacy npm anthropic plugin for the vendored
 * local one. Preserves unknown user entries. Returns true if the file was
 * modified (caller should restart the opencode subprocess).
 *
 * `configPath` is overridable for tests only.
 */
export function ensureRequiredPlugins(
  configPath: string = OPENCODE_CONFIG_PATH,
): boolean {
  let parsed: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      logger.error(
        '[OpencodePluginConfig] opencode.json is malformed; leaving alone:',
        err,
      );
      return false;
    }
  } else {
    parsed['$schema'] = 'https://opencode.ai/config.json';
  }

  const existing = Array.isArray(parsed.plugin)
    ? (parsed.plugin as string[])
    : [];
  const pluginPath = rhythmAnthropicPluginPath();
  const merged = Array.from(
    new Set([
      ...existing.filter((p) => !LEGACY_PLUGINS.includes(p)),
      ...REQUIRED_PLUGINS,
      ...(pluginPath ? [pluginPath] : []),
    ]),
  );
  const changed =
    merged.length !== existing.length ||
    merged.some((p, i) => p !== existing[i]);
  if (!changed) {
    return false;
  }

  parsed.plugin = merged;
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    logger.info(
      `[OpencodePluginConfig] Updated plugin list in ${configPath}: ${merged.join(', ')}`,
    );
    return true;
  } catch (err) {
    logger.error('[OpencodePluginConfig] Failed to write opencode.json:', err);
    return false;
  }
}
