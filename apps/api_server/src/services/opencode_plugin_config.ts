import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import { env } from '../config/env';

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

// ── #1054 (OCU-13) — wire the engine's skills.urls at the org skill index ──

/**
 * Default production API base (mirrors the Flutter `AppConstants.apiBaseUrl`
 * fallback). Used only when `env.prodApiUrl` (PROD_API_URL) is unset — see
 * that field's doc comment in config/env.ts for the "when absent" precedent
 * (sync_orchestrator_service.ts's identical resolution for task mirroring).
 */
const DEFAULT_PROD_API_BASE = 'https://api.vcrcapps.com';

/**
 * The production base this instance mirrors/publishes org skills to/from,
 * trimmed of any trailing slash. Exported so #1056's publish-to-org applier
 * (org_proposal_appliers_wiring.ts) resolves the SAME base as this module —
 * one source of truth for "where does the org skill library live".
 */
export function resolveProdApiBase(): string {
  const configured = env.prodApiUrl?.trim();
  const base = configured && configured.length > 0 ? configured : DEFAULT_PROD_API_BASE;
  return base.replace(/\/+$/, '');
}

/**
 * Test/dev override for WHICH opencode.json `ensureOrgSkillIndex` reads and
 * writes, so a live-e2e run can point at a throwaway temp file instead of the
 * real `~/.config/opencode/opencode.json` (a prior agent accidentally wrote a
 * test MCP entry into the real file — see docs/ai/runs on that incident).
 * Unset (the default) leaves today's real path unchanged.
 */
function resolveOpencodeConfigPath(): string {
  const override = process.env.RHYTHM_OPENCODE_CONFIG_PATH?.trim();
  return override && override.length > 0 ? override : OPENCODE_CONFIG_PATH;
}

/**
 * True when `url`'s path is exactly `/org-skills` (host/port-agnostic) — this
 * is how {@link ensureOrgSkillIndex} recognizes ITS OWN previously-written
 * entry among a user's `skills.urls` list, so changing the configured
 * production URL replaces that one entry instead of appending a duplicate.
 * A malformed URL string never matches (never touched, never crashes).
 */
function isOrgSkillsIndexUrl(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') === '/org-skills';
  } catch {
    return false;
  }
}

/**
 * Idempotently ensure the managed opencode.json's `skills.urls` contains
 * exactly one entry pointing at this org's shared skill index
 * (`<prodBase>/org-skills` — the fork's `skill/discovery.ts` `Discovery.pull`
 * treats a `skills.urls` entry as a BASE directory and fetches `index.json`
 * relative to it, so the entry must NOT itself end in `/index.json`).
 *
 * Preserves every other user-added `skills.urls` entry and NEVER touches
 * `skills.paths`. Never throws — a missing/malformed config is left alone
 * (logged, returns false) so a config problem here can never block engine
 * startup; the engine tolerates an unreachable/absent `skills.urls` entry on
 * its own (Discovery.pull catches its own fetch errors).
 *
 * Returns true iff the file was modified (mirrors {@link ensureRequiredPlugins}).
 */
export function ensureOrgSkillIndex(
  orgSkillsBaseUrl: string = `${resolveProdApiBase()}/org-skills`,
  configPath: string = resolveOpencodeConfigPath(),
): boolean {
  let parsed: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      logger.error(
        '[OpencodePluginConfig] opencode.json is malformed; leaving alone (org skill index not ensured):',
        err,
      );
      return false;
    }
  } else {
    parsed['$schema'] = 'https://opencode.ai/config.json';
  }

  const skillsBlock: Record<string, unknown> =
    parsed.skills && typeof parsed.skills === 'object' && !Array.isArray(parsed.skills)
      ? (parsed.skills as Record<string, unknown>)
      : {};
  const existingUrls = Array.isArray(skillsBlock.urls) ? (skillsBlock.urls as string[]) : [];

  const withoutOurs = existingUrls.filter((u) => !isOrgSkillsIndexUrl(u));
  const nextUrls = [...withoutOurs, orgSkillsBaseUrl];

  const unchanged =
    existingUrls.length === nextUrls.length && existingUrls.every((u, i) => u === nextUrls[i]);
  if (unchanged) {
    return false;
  }

  parsed.skills = { ...skillsBlock, urls: nextUrls };
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    logger.info(`[OpencodePluginConfig] ensured org skill index in skills.urls: ${orgSkillsBaseUrl}`);
    return true;
  } catch (err) {
    logger.error(
      '[OpencodePluginConfig] failed to write opencode.json (org skill index not ensured):',
      err,
    );
    return false;
  }
}
