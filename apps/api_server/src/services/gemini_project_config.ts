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
