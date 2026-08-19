/**
 * numbat_observability_service.ts — #1452 (observe-only Numbat OpenCode monitoring)
 *
 * Wires perplexityai/numbat's OBSERVE-ONLY OpenCode hook into api_server
 * startup. Unlike `opencode_plugin_config.ts`'s `ensureRequiredPlugins()`,
 * numbat's installer does NOT go through Rhythm's opencode.json `plugin`
 * array — it writes its own auto-loaded global plugin file straight to
 * `${XDG_CONFIG_HOME:-~/.config}/opencode/plugins/numbat.ts`, a completely
 * separate OpenCode plugin-loading mechanism (see the decision record). So
 * this service's only job is: resolve the `numbat` binary, then spawn
 * `numbat hook install --agent opencode --emit all --content preview` as a
 * one-shot, fire-and-forget subprocess. numbat's own installer is idempotent,
 * so re-running this on every startup is safe.
 *
 * Full design rationale + every verified upstream fact (install command,
 * flag defaults, plugin template, HTTP/enforcement posture):
 * docs/ai/decisions/2026-08-18-numbat-observability-integration.md
 *
 * Contract (never deviate without re-reading the decision record):
 *  - `RHYTHM_NUMBAT_MONITORING_DISABLED=1` short-circuits BEFORE any binary
 *    resolution or spawn attempt.
 *  - `--enforce` is NEVER passed (upstream rejects it for --agent opencode
 *    anyway — this is not a substitute for rhythm_request_approval).
 *  - `--output http` / `--http-url` are NEVER passed (local-only, no
 *    telemetry) — `--output file` is numbat's own default, left implicit.
 *  - `--content full` is NEVER passed — `--content preview` (<=200 code
 *    point, redacted) is explicit.
 *  - Never throws into api_server startup: disabled, absent-binary, and
 *    spawn-failure are all fail-open, logged-once, no-op paths.
 */
import { spawn, type ChildProcess } from 'child_process';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'fs';
import { logger } from '../utils/logger';

const KNOWN_NUMBAT_PATHS = ['/opt/homebrew/bin/numbat', '/usr/local/bin/numbat'];

/** The exact, fixed, observe-only install invocation — see module doc contract. */
const NUMBAT_INSTALL_ARGS = ['hook', 'install', '--agent', 'opencode', '--emit', 'all', '--content', 'preview'];

export interface NumbatBinaryResolutionDeps {
  envGet?: (key: string) => string | undefined;
  fsExists?: (p: string) => boolean;
  /** Resolve a bare command name via PATH. Returns an absolute path or null. Never throws. */
  which?: (bin: string) => string | null;
}

function defaultWhich(bin: string): string | null {
  try {
    const result = execFileSync('/usr/bin/which', [bin], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Locate the `numbat` binary using the priority order:
 *   1. RHYTHM_NUMBAT_BIN_PATH env override (if set and exists)
 *   2. Known Homebrew install paths (/opt/homebrew/bin, /usr/local/bin)
 *   3. Bare `numbat` resolved via inherited PATH
 *
 * Returns the binary path, or null if none found. Never throws — Rhythm's
 * api_server is spawned by the Flutter desktop app, which does not reliably
 * inherit a Homebrew-augmented shell PATH the way a Terminal-launched process
 * would, so an absent binary here is an expected, non-error outcome.
 */
export function resolveNumbatBinary(deps: NumbatBinaryResolutionDeps = {}): string | null {
  const envGet = deps.envGet ?? ((k: string) => process.env[k]);
  const fsExists = deps.fsExists ?? existsSync;
  const which = deps.which ?? defaultWhich;

  const override = envGet('RHYTHM_NUMBAT_BIN_PATH')?.trim();
  if (override) {
    if (fsExists(override)) return override;
    logger.warn(`[NumbatObservability] RHYTHM_NUMBAT_BIN_PATH=${override} does not exist — ignoring override`);
  }

  for (const candidate of KNOWN_NUMBAT_PATHS) {
    if (fsExists(candidate)) return candidate;
  }

  return which('numbat');
}

export interface NumbatObservabilityDeps {
  envGet?: (key: string) => string | undefined;
  resolveBinary?: (deps?: NumbatBinaryResolutionDeps) => string | null;
  spawnFn?: typeof spawn;
  logInfo?: (message: string) => void;
  logWarn?: (message: string) => void;
}

/**
 * Idempotently ensure the observe-only numbat OpenCode hook is installed.
 * Call once at api_server startup, inside `if (env.agentExecutionEnabled)`,
 * in its own try/catch independent of `opencode_plugin_config.ts`'s calls.
 *
 * Never throws. Returns nothing — this is a fire-and-forget side effect, not
 * a value callers act on (mirrors `ensureRequiredPlugins()`'s fail-open
 * contract, but there is no config file for THIS process to read/write —
 * numbat's own CLI owns writing its plugin file).
 */
export function ensureNumbatObservability(deps: NumbatObservabilityDeps = {}): void {
  const envGet = deps.envGet ?? ((k: string) => process.env[k]);
  const info = deps.logInfo ?? ((m: string) => logger.info(m));
  const warn = deps.logWarn ?? ((m: string) => logger.warn(m));

  if (envGet('RHYTHM_NUMBAT_MONITORING_DISABLED') === '1') {
    info('[NumbatObservability] Disabled via RHYTHM_NUMBAT_MONITORING_DISABLED=1 — skipping numbat hook install.');
    return;
  }

  const resolveBinary = deps.resolveBinary ?? resolveNumbatBinary;
  let bin: string | null;
  try {
    bin = resolveBinary();
  } catch (err) {
    warn(`[NumbatObservability] binary resolution failed (non-fatal): ${String(err)}`);
    return;
  }
  if (!bin) {
    info(
      '[NumbatObservability] numbat binary not found (checked RHYTHM_NUMBAT_BIN_PATH, ' +
        '/opt/homebrew/bin, /usr/local/bin, and PATH) — observe-only monitoring stays inert. ' +
        'Install https://github.com/perplexityai/numbat to enable it.',
    );
    return;
  }

  const doSpawn = deps.spawnFn ?? spawn;
  try {
    const child: ChildProcess = doSpawn(bin, NUMBAT_INSTALL_ARGS, {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', (err) => {
      warn(`[NumbatObservability] numbat hook install subprocess error (non-fatal): ${err.message}`);
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        warn(`[NumbatObservability] numbat hook install exited with code ${code}`);
      }
    });
    child.unref();
    info(`[NumbatObservability] invoked: ${bin} ${NUMBAT_INSTALL_ARGS.join(' ')}`);
  } catch (err) {
    warn(`[NumbatObservability] failed to spawn numbat hook install (non-fatal): ${String(err)}`);
  }
}
