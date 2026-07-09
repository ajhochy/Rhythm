import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import { GEMINI_CODE_ASSIST_PROJECT_ID } from '../config/env';

export interface EnsureGeminiProjectConfigResult {
  changed: boolean;
  projectId: string;
}

/**
 * Idempotently ensure `provider.google.options.projectId` is set in the
 * opencode config so the `opencode-gemini-auth` plugin registers the native
 * Google Gemini provider for Workspace accounts.
 *
 * Behaviour:
 *   - Missing file        → starts from `{}` and writes the projectId.
 *   - Parse error         → logs and returns WITHOUT writing, so a user's
 *                           hand-edited config is never clobbered.
 *   - Already correct     → no write (idempotent), `changed: false`.
 *   - Different / missing  → sets it, creating provider/google/options as
 *                           needed, WITHOUT touching any other keys.
 *
 * Never throws on IO errors (logs + continues) — this must not block engine
 * startup. `opts.configPath`/`opts.projectId` override the defaults for tests.
 */
export function ensureGeminiProjectConfig(opts?: {
  configPath?: string;
  projectId?: string;
}): EnsureGeminiProjectConfigResult {
  const projectId = opts?.projectId ?? GEMINI_CODE_ASSIST_PROJECT_ID;
  const configPath =
    opts?.configPath ?? join(homedir(), '.config', 'opencode', 'opencode.json');

  let parsed: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        parsed = {};
      }
    } catch (err) {
      // Tolerate parse error: do NOT clobber a hand-edited config.
      logger.warn(
        `[GeminiProjectConfig] could not parse opencode.json at ${configPath} — leaving it untouched: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { changed: false, projectId };
    }
  }

  const provider =
    (parsed.provider as Record<string, unknown> | undefined) ?? {};
  const google = (provider.google as Record<string, unknown> | undefined) ?? {};
  const options = (google.options as Record<string, unknown> | undefined) ?? {};

  if (options.projectId === projectId) {
    return { changed: false, projectId };
  }

  options.projectId = projectId;
  google.options = options;
  provider.google = google;
  parsed.provider = provider;

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  } catch (err) {
    // Never throw — engine startup must continue even if the write fails.
    logger.warn(
      `[GeminiProjectConfig] could not write opencode.json at ${configPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { changed: false, projectId };
  }

  return { changed: true, projectId };
}

/**
 * #927 — make the Gemini projectId available to the engine subprocess via the
 * `OPENCODE_GEMINI_PROJECT_ID` environment variable.
 *
 * Why this and not just the opencode.json write above: the `opencode-gemini-auth`
 * plugin resolves the configured projectId in priority order —
 *   OPENCODE_GEMINI_PROJECT_ID (env)  ›  provider.options.projectId  ›
 *   client.config.get() (the ENGINE'S config)  ›  a module-level cache  ›
 *   GOOGLE_CLOUD_PROJECT
 * — and reads the env resolver LIVE on every turn (no cache). The config-file
 * path we write above is only surfaced to the plugin through the engine's
 * `config.get()`, which the fork memoizes for the engine's whole lifetime
 * (Duration.infinity) and whose parsed shape does not reliably re-expose the
 * nested `provider.google.options.projectId` to the plugin; the plugin's
 * module-level fallback is repopulated only when the provider is re-registered
 * (which is exactly what merely CLICKING Re-auth triggers). That fragile chain
 * is why the projectId intermittently reads as "missing" mid-session until a
 * manual Re-auth click, and why the earlier opencode.json-only fix (#927) did
 * not hold. Setting the env var — the plugin's highest-priority, cache-free
 * resolver — makes every turn resolve the projectId deterministically, with no
 * click and no dependence on the engine's config cache.
 *
 * The engine is spawned by `createOpencode()` which inherits `process.env`
 * (see `@opencode-ai/sdk` server spawn: `env: { ...process.env, ... }`), so
 * this must run BEFORE the engine spawns. Respects an operator-provided value:
 * an existing non-empty `OPENCODE_GEMINI_PROJECT_ID` is never overwritten.
 */
export function ensureGeminiProjectEnv(opts?: { projectId?: string }): string {
  const existing = process.env.OPENCODE_GEMINI_PROJECT_ID?.trim();
  if (existing) return existing;
  const projectId = opts?.projectId ?? GEMINI_CODE_ASSIST_PROJECT_ID;
  process.env.OPENCODE_GEMINI_PROJECT_ID = projectId;
  return projectId;
}
