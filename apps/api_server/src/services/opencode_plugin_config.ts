import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

/**
 * The SDK ships built-in loaders for `openrouter`, `openai`, `github-copilot`,
 * and `opencode`. Direct routing to `anthropic` and `google` requires
 * community plugins to be listed in `~/.config/opencode/opencode.json`'s
 * `plugin` array — opencode auto-installs them from npm at runtime.
 *
 * These plugins extend the provider catalog so session.prompt({providerID:
 * 'anthropic', ...}) actually has a loader to dispatch to. The user's
 * existing OAuth credentials (already bridged into auth.json) become
 * usable via the direct provider routes once these are installed.
 */
const REQUIRED_PLUGINS = [
  'opencode-claude-auth', // anthropic loader via Claude Code Keychain creds
  'opencode-openai-codex-auth', // openai loader via ChatGPT Plus OAuth (Codex backend)
  'opencode-gemini-auth', // google loader via Google AI subscription
];

const OPENCODE_CONFIG_PATH = join(
  homedir(),
  '.config',
  'opencode',
  'opencode.json',
);

/**
 * Idempotently ensures the required community auth plugins are listed in
 * opencode.json. Returns true if the file was modified (caller should
 * restart the opencode subprocess to pick up the new plugins).
 */
export function ensureRequiredPlugins(): boolean {
  let parsed: Record<string, unknown> = {};
  if (existsSync(OPENCODE_CONFIG_PATH)) {
    try {
      parsed = JSON.parse(readFileSync(OPENCODE_CONFIG_PATH, 'utf8'));
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
  const merged = Array.from(new Set([...existing, ...REQUIRED_PLUGINS]));
  if (merged.length === existing.length) {
    return false;
  }

  parsed.plugin = merged;
  try {
    mkdirSync(dirname(OPENCODE_CONFIG_PATH), { recursive: true });
    writeFileSync(
      OPENCODE_CONFIG_PATH,
      JSON.stringify(parsed, null, 2) + '\n',
      'utf8',
    );
    logger.info(
      `[OpencodePluginConfig] Added required plugins to ${OPENCODE_CONFIG_PATH}: ` +
        REQUIRED_PLUGINS.filter((p) => !existing.includes(p)).join(', '),
    );
    return true;
  } catch (err) {
    logger.error('[OpencodePluginConfig] Failed to write opencode.json:', err);
    return false;
  }
}
