import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import { env, resolveMemoryVaultPath } from '../config/env';
import { resolveSmallModel } from './agent_model_resolver';
import { UsersRepository } from '../repositories/users_repository';
import {
  canonicalManagedPluginIdentity,
  type ManagedPluginPaths,
  type RhythmManagedPluginName,
} from './opencode_plugin_identity';

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

function resolveVendoredPluginPath(
  name: RhythmManagedPluginName,
): string | null {
  const candidates = [
    join(__dirname, '..', '..', 'opencode_plugins', name),
    join(__dirname, '..', 'opencode_plugins', name),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

/**
 * Resolve the vendored anthropic plugin dir in both layouts:
 * dev (tsx runs from src/services) and packaged (dist/services, with
 * opencode_plugins copied as a sibling of dist by desktop_release.yml).
 */
export function rhythmAnthropicPluginPath(): string | null {
  return resolveVendoredPluginPath('rhythm-anthropic-accounts');
}

/**
 * #1069 (OCU-28) — resolve the vendored rhythm-telemetry plugin dir, same
 * dev/packaged dual-layout search as {@link rhythmAnthropicPluginPath}.
 * Returns null when `RHYTHM_TOOL_TELEMETRY_DISABLED=1` — the plugin is then
 * never even added to opencode.json's `plugin` array (the plugin file itself
 * ALSO self-disables via the same env var if somehow already registered from
 * a prior run — belt and suspenders, see its own doc comment).
 */
export function rhythmTelemetryPluginPath(): string | null {
  if (process.env.RHYTHM_TOOL_TELEMETRY_DISABLED === '1') return null;
  return resolveVendoredPluginPath('rhythm-telemetry');
}

/**
 * Resolve the always-enabled session-context plugin. Unlike telemetry this
 * has no disable flag: it is part of the memory provenance correctness
 * boundary, not optional instrumentation.
 */
export function rhythmSessionContextPluginPath(): string | null {
  return resolveVendoredPluginPath('rhythm-session-context');
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
  const telemetryPluginPath = rhythmTelemetryPluginPath();
  const sessionContextPluginPath = rhythmSessionContextPluginPath();
  const managedPluginPaths: ManagedPluginPaths = {
    'rhythm-anthropic-accounts': pluginPath,
    // Keep the physical path available for identity even when telemetry is
    // disabled and therefore omitted from the active registration list.
    'rhythm-telemetry':
      telemetryPluginPath ?? resolveVendoredPluginPath('rhythm-telemetry'),
    'rhythm-session-context': sessionContextPluginPath,
  };

  // Replace every positively identified managed copy with the active paths
  // from this checkout/package. Identity is checkout-independent, so stale
  // worktree paths and realpath aliases cannot leave multiple plugin modules
  // active. Unknown entries remain untouched.
  const preservedUserEntries = existing.filter(
    (entry) =>
      !LEGACY_PLUGINS.includes(entry) &&
      canonicalManagedPluginIdentity(entry, managedPluginPaths) === null,
  );
  const merged = Array.from(
    new Set([
      ...preservedUserEntries,
      ...REQUIRED_PLUGINS,
      ...(pluginPath ? [pluginPath] : []),
      ...(telemetryPluginPath ? [telemetryPluginPath] : []),
      ...(sessionContextPluginPath ? [sessionContextPluginPath] : []),
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

// ── #1071 (OCU-30) — managed config adoption: small_model, username, ────────
// reference, compaction/tool_output defaults ─────────────────────────────────

/**
 * Repo docs dir, resolved the same way agent_sessions_controller resolves
 * `.mcp-roles/` (`src/services/` → `../../../../` = repo root). Overridable
 * via RHYTHM_DOCS_DIR for a packaged/bundled layout where the repo tree isn't
 * present alongside the compiled server.
 */
function resolveDocsDir(): string {
  const override = process.env.RHYTHM_DOCS_DIR?.trim();
  if (override) return override;
  return join(__dirname, '..', '..', '..', '..', 'docs');
}

/**
 * Idempotently ensure opencode.json's managed defaults beyond
 * plugin/mcp/$schema, using the same read-merge-write + preserve-unknown-keys
 * discipline as `ensureRequiredPlugins`/`ensureOrgSkillIndex`. Two write
 * policies, per key:
 *
 *  - `small_model` / `username` — RHYTHM-OWNED: recomputed and kept current
 *    on every call. `small_model` is skipped entirely (never written, never
 *    cleared) when no candidate provider is authed — see
 *    `agent_model_resolver.resolveSmallModel`'s fail-safe contract.
 *  - `reference` — ADDITIVE: Rhythm's own alias entries (`vault`, `docs`) are
 *    kept current; every other alias key a user added is preserved untouched.
 *    Each Rhythm entry is skipped when its target path doesn't exist, rather
 *    than registering a dead reference.
 *  - `compaction` / `tool_output` — ABSENT-ONLY: written once with sane
 *    (engine-default-matching) values ONLY when the key is missing entirely;
 *    never touched again once present, so a user's own tuning always wins.
 *
 * Never throws — a malformed config is left alone (logged, returns false),
 * matching the existing functions' fail-safe contract. Returns true iff the
 * file was modified (caller should reloadConfig).
 */
export async function ensureManagedDefaults(
  configPath: string = resolveOpencodeConfigPath(),
): Promise<boolean> {
  let parsed: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      logger.error(
        '[OpencodePluginConfig] opencode.json is malformed; leaving alone (managed defaults not ensured):',
        err,
      );
      return false;
    }
  } else {
    parsed['$schema'] = 'https://opencode.ai/config.json';
  }

  let changed = false;

  // small_model — RHYTHM-OWNED. Skip (never write/clear) when unauthed.
  try {
    const small = await resolveSmallModel();
    if (small) {
      const value = `${small.providerID}/${small.modelID}`;
      if (parsed.small_model !== value) {
        parsed.small_model = value;
        changed = true;
      }
    }
  } catch (err) {
    logger.warn('[OpencodePluginConfig] small_model resolution failed (non-fatal, skipping):', err);
  }

  // username — RHYTHM-OWNED. Uses the primary local user's display name
  // (Rhythm is single-user-per-machine; the system bot row is excluded).
  try {
    const users = await new UsersRepository().findAllAsync();
    const primary = users.find((u) => u.email !== UsersRepository.systemBotEmail);
    if (primary?.name && parsed.username !== primary.name) {
      parsed.username = primary.name;
      changed = true;
    }
  } catch (err) {
    logger.warn('[OpencodePluginConfig] username resolution failed (non-fatal, skipping):', err);
  }

  // reference — ADDITIVE. Only Rhythm's own two aliases are managed; every
  // other alias a user added is left byte-for-byte untouched.
  const referenceBlock: Record<string, unknown> =
    parsed.reference && typeof parsed.reference === 'object' && !Array.isArray(parsed.reference)
      ? (parsed.reference as Record<string, unknown>)
      : {};
  const nextReference = { ...referenceBlock };
  // Live-read (mirrors resolveApprovalsMode's "read fresh" convention) so a
  // test/late .env override without a module reload is honored.
  const vaultPath = resolveMemoryVaultPath();
  if (vaultPath && existsSync(vaultPath)) {
    const entry = { path: vaultPath };
    if (JSON.stringify(nextReference.vault) !== JSON.stringify(entry)) {
      nextReference.vault = entry;
      changed = true;
    }
  }
  const docsDir = resolveDocsDir();
  if (existsSync(docsDir)) {
    const entry = { path: docsDir };
    if (JSON.stringify(nextReference.docs) !== JSON.stringify(entry)) {
      nextReference.docs = entry;
      changed = true;
    }
  }
  if (Object.keys(nextReference).length > 0) {
    parsed.reference = nextReference;
  }

  // compaction / tool_output — ABSENT-ONLY, never override user tuning.
  // Values mirror the engine's own documented defaults (config.ts) so writing
  // them is a no-op behaviorally — it only makes the knobs discoverable/
  // tunable in the file rather than implicit.
  if (parsed.compaction === undefined) {
    parsed.compaction = { auto: true, prune: true };
    changed = true;
  }
  if (parsed.tool_output === undefined) {
    parsed.tool_output = { max_lines: 2000, max_bytes: 51200 };
    changed = true;
  }

  if (!changed) return false;

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    logger.info(
      '[OpencodePluginConfig] ensured managed defaults (small_model/username/reference/compaction/tool_output)',
    );
    return true;
  } catch (err) {
    logger.error(
      '[OpencodePluginConfig] failed to write opencode.json (managed defaults not ensured):',
      err,
    );
    return false;
  }
}

// ── #1072 (OCU-31) — org instructions synced from production ────────────────

/** The Rhythm-managed instructions file every local machine writes/reads. */
function resolveOrgInstructionsFilePath(): string {
  const override = process.env.RHYTHM_ORG_INSTRUCTIONS_FILE?.trim();
  if (override) return override;
  return join(homedir(), '.config', 'opencode', 'rhythm-org-instructions.md');
}

/**
 * Fetch the org instructions markdown from `${prodApiBase}/org-settings/instructions`
 * with a short timeout. Returns null on ANY failure (unreachable, non-200,
 * malformed body, empty content) — callers must fall back to the cached file
 * rather than treat null as "clear the instructions". Never throws.
 */
async function fetchOrgInstructions(prodApiBase: string): Promise<string | null> {
  try {
    const res = await fetch(`${prodApiBase}/org-settings/instructions`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: unknown };
    return typeof body.content === 'string' && body.content.trim() !== '' ? body.content : null;
  } catch (err) {
    logger.warn(`[OpencodePluginConfig] org instructions fetch failed (non-fatal, using cache): ${String(err)}`);
    return null;
  }
}

/**
 * Idempotently sync the org's instructions markdown from production into
 * this machine's opencode config:
 *
 *  1. Fetch the current content from prod (short timeout, never blocks
 *     startup). On failure, fall back to whatever is already cached on disk
 *     — never treat "prod unreachable" as "clear the instructions".
 *  2. Write the resolved content to a Rhythm-managed file (only when it
 *     actually changed, so this is a no-op write on every subsequent daily
 *     sync that finds the same content).
 *  3. Ensure opencode.json's `instructions` array contains that file's path
 *     — ADDITIVE, every other entry a user added is preserved untouched.
 *
 * Returns true iff opencode.json was modified (caller should reloadConfig).
 * Never throws — any failure at any step is logged and treated as "nothing
 * to do this pass," matching the other ensure-/sync-prefixed functions above.
 */
export async function syncOrgInstructions(
  prodApiBase: string = resolveProdApiBase(),
  configPath: string = resolveOpencodeConfigPath(),
  instructionsFilePath: string = resolveOrgInstructionsFilePath(),
): Promise<boolean> {
  const fetched = await fetchOrgInstructions(prodApiBase);
  const cached = existsSync(instructionsFilePath) ? readFileSync(instructionsFilePath, 'utf8') : null;
  const content = fetched ?? cached;
  if (content === null) {
    // Never fetched successfully AND nothing cached yet — nothing to
    // register. Startup must never block on this.
    return false;
  }

  if (fetched !== null && fetched !== cached) {
    try {
      mkdirSync(dirname(instructionsFilePath), { recursive: true });
      writeFileSync(instructionsFilePath, fetched, 'utf8');
      logger.info(`[OpencodePluginConfig] wrote org instructions to ${instructionsFilePath}`);
    } catch (err) {
      logger.error('[OpencodePluginConfig] failed to write org instructions file (using in-memory content only for this pass):', err);
    }
  }

  let parsed: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      logger.error(
        '[OpencodePluginConfig] opencode.json is malformed; leaving alone (org instructions not registered):',
        err,
      );
      return false;
    }
  } else {
    parsed['$schema'] = 'https://opencode.ai/config.json';
  }

  const existingInstructions = Array.isArray(parsed.instructions)
    ? (parsed.instructions as string[])
    : [];
  if (existingInstructions.includes(instructionsFilePath)) {
    return false; // already registered; the file write above (if any) doesn't need a config change
  }

  parsed.instructions = [...existingInstructions, instructionsFilePath];
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    logger.info(`[OpencodePluginConfig] registered org instructions in instructions[]: ${instructionsFilePath}`);
    return true;
  } catch (err) {
    logger.error('[OpencodePluginConfig] failed to write opencode.json (org instructions not registered):', err);
    return false;
  }
}
