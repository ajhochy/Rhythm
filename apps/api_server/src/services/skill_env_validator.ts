/**
 * skill_env_validator.ts — #874 (setup-04): skills declare required env vars.
 *
 * SKILL.md frontmatter can declare `required_environment_variables` (parsed by
 * skill_frontmatter.ts). This module is the detection + storage layer:
 *
 *   - `checkRequiredEnv` — which declared vars are missing vs. already set.
 *     Already-set vars (from process.env, which dotenv has already merged from
 *     `.env` at server boot — see server.ts's `loadDotenv`) are never re-asked.
 *   - `storeEnvVar` — persists a collected value into `.env` with 0600
 *     permissions (owner read/write only) and sets it on `process.env`
 *     immediately so it's available to sandboxed skill execution without a
 *     restart, per the issue's "declared vars are automatically passed through
 *     to any sandboxed code execution" requirement (a child process spawned
 *     with `env: process.env` — or no override at all — inherits it).
 *   - `buildMessagingConfigInstruction` — the non-CLI-surface path: messaging
 *     platforms (Telegram, etc.) must never prompt for a secret in chat, only
 *     point at `rhythm setup` / `.env`.
 *
 * Rhythm has no interactive CLI TTY of its own (unlike the hermes-agent prior
 * art) — the "masked secure input prompt" the issue describes is a UI-layer
 * concern (an actual terminal, `rhythm doctor`, or a Flutter dialog) that
 * calls `checkRequiredEnv` to know what to ask for and `storeEnvVar` to save
 * the answer. This module intentionally does not implement a TTY reader.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { RequiredEnvVar } from './skill_frontmatter';

export interface RequiredEnvCheckResult {
  /** Declared vars whose value is missing/empty in process.env. */
  missing: RequiredEnvVar[];
  /** Names of declared vars that already have a non-empty value. */
  satisfied: string[];
  /** True when every declared var is satisfied (true for an empty declaration). */
  allSatisfied: boolean;
}

/**
 * Check a skill's declared `required_environment_variables` against the
 * current process environment. A skill declaring no vars always yields
 * `allSatisfied: true` with both lists empty — the "behaves exactly as
 * before" regression contract.
 */
export function checkRequiredEnv(required: RequiredEnvVar[]): RequiredEnvCheckResult {
  const missing: RequiredEnvVar[] = [];
  const satisfied: string[] = [];
  for (const v of required) {
    const current = process.env[v.name];
    if (current !== undefined && current !== '') {
      satisfied.push(v.name);
    } else {
      missing.push(v);
    }
  }
  return { missing, satisfied, allSatisfied: missing.length === 0 };
}

/** Default `.env` path — the api_server root, matching server.ts's loadDotenv call. */
export function defaultEnvPath(): string {
  return path.join(__dirname, '..', '..', '.env');
}

/** True when a raw .env value needs quoting to stay parseable (spaces, '#', quotes, newlines). */
function needsQuoting(value: string): boolean {
  return /[\s#"'\\]/.test(value) || value === '';
}

function formatEnvValue(value: string): string {
  if (!needsQuoting(value)) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Persist a single env var into the `.env` file at `envPath` (defaults to the
 * api_server root), creating it if absent, updating the line in place if the
 * key already exists, and appending otherwise. Writes with mode 0600 (owner
 * read/write only) — never group/world-readable, since this file holds
 * secrets. Also sets `process.env[name]` immediately so callers (and any
 * child process spawned after this point) see the value without a restart.
 *
 * Never writes to any git-tracked config file — `.env` is git-ignored
 * (see apps/api_server/.gitignore) and this function only ever targets the
 * path passed in / the default `.env` location.
 */
export function storeEnvVar(name: string, value: string, envPath: string = defaultEnvPath()): void {
  const line = `${name}=${formatEnvValue(value)}`;
  let lines: string[] = [];
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, 'utf8').split('\n');
  }

  const keyPrefix = `${name}=`;
  let replaced = false;
  const nextLines = lines.map((l) => {
    if (l.startsWith(keyPrefix)) {
      replaced = true;
      return line;
    }
    return l;
  });
  if (!replaced) {
    // Drop a single trailing empty line (from a prior write's trailing \n)
    // before appending, so we don't accumulate blank lines.
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
      nextLines.pop();
    }
    nextLines.push(line);
  }

  const contents = nextLines.join('\n') + '\n';
  writeFileSync(envPath, contents, { mode: 0o600 });
  // Belt-and-suspenders: writeFileSync's mode is only applied on CREATE: if
  // envPath already existed with looser permissions, explicitly chmod it.
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // Non-fatal — best-effort permission tightening.
  }

  process.env[name] = value;
}

/**
 * Build the plain-text configuration instruction shown on messaging surfaces
 * (Telegram, etc.) when a skill's required env vars are missing. Never asks
 * for the secret value itself — only points at where to configure it.
 */
export function buildMessagingConfigInstruction(missing: RequiredEnvVar[]): string {
  const names = missing.map((v) => v.name).join(', ');
  const lines = [
    `This skill needs configuration before it can run: ${names}.`,
    `Set it via \`rhythm setup\` or by editing your .env file — not here in chat.`,
  ];
  for (const v of missing) {
    if (v.help) lines.push(`${v.name}: ${v.help}`);
  }
  return lines.join('\n');
}
