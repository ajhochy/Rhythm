/**
 * OCU-09 (#1050) — Rhythm-managed slash-command files.
 *
 * Engine slash commands live at `<config-dir>/commands/<name>.md` (the engine
 * scans `{command,commands}/ ** / *.md` under its config dir — see
 * apps/opencode_fork/.../config/command.ts). Each file is frontmatter
 * (description, agent, model, subtask) + a body template that may reference
 * `$ARGUMENTS` or `$1..$n`. After any write/delete, POST /config/reload makes
 * the change live without an engine restart.
 *
 * This module owns ONLY the Rhythm-managed `commands/` dir. Built-in commands
 * (init, review) and MCP/skill-sourced commands are never written or deleted
 * here — the routes layer refuses to touch a name that isn't a managed file.
 *
 * Mirrors rhythm_managed_skills.ts: the dir root is resolved lazily (never a
 * captured constant) so tests redirect it via RHYTHM_MANAGED_COMMANDS_DIR
 * without touching $HOME.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Canonical Rhythm-managed commands dir — `~/.config/opencode/commands`, the
 * engine's auto-scanned config commands dir. Overridable via
 * RHYTHM_MANAGED_COMMANDS_DIR for tests.
 */
export function managedCommandsRoot(): string {
  return (
    process.env.RHYTHM_MANAGED_COMMANDS_DIR ??
    join(homedir(), '.config', 'opencode', 'commands')
  );
}

export class InvalidCommandNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommandNameError';
  }
}

/** kebab-case: lowercase alphanumerics and single hyphens, no leading/trailing/double hyphens. */
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate a command name (kebab-case, no path traversal) and return it.
 * Throws {@link InvalidCommandNameError} on bad input.
 */
export function validateCommandName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new InvalidCommandNameError('command name is required');
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new InvalidCommandNameError(`command name '${name}' must not contain path separators`);
  }
  if (!KEBAB_RE.test(trimmed)) {
    throw new InvalidCommandNameError(
      `command name '${name}' must be kebab-case (lowercase letters, digits, single hyphens)`,
    );
  }
  return trimmed;
}

/** Frontmatter fields a managed command file carries (all optional). */
export interface CommandFrontmatter {
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
}

export interface ManagedCommandInput extends CommandFrontmatter {
  name: string;
  /** Body template (everything after the frontmatter): the prompt with $ARGUMENTS/$1..$n. */
  template: string;
}

/** Path to a managed command's .md file (name assumed already validated). */
function commandPath(name: string): string {
  return join(managedCommandsRoot(), `${name}.md`);
}

/** True when a Rhythm-managed file exists for this name. */
export function isManagedCommand(name: string): boolean {
  try {
    return existsSync(commandPath(validateCommandName(name)));
  } catch {
    return false;
  }
}

/** Names of all Rhythm-managed commands currently on disk. */
export function listManagedCommandNames(): string[] {
  const dir = managedCommandsRoot();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));
}

/**
 * Serialize a managed command to `<name>.md` frontmatter + body and write it,
 * returning the absolute path. Overwrites an existing managed file (PUT/POST
 * share this). Preserves unknown frontmatter keys the caller passes through the
 * `extraFrontmatter` map (used by PUT to round-trip keys this module doesn't
 * model). Never validates the name here — callers validate first so a 400 is
 * raised before any disk write.
 */
export function writeManagedCommand(
  input: ManagedCommandInput,
  extraFrontmatter?: Record<string, unknown>,
): string {
  const name = validateCommandName(input.name);
  const dir = managedCommandsRoot();
  mkdirSync(dir, { recursive: true });

  const fm: Record<string, unknown> = { ...(extraFrontmatter ?? {}) };
  if (input.description !== undefined) fm.description = input.description;
  if (input.agent !== undefined) fm.agent = input.agent;
  if (input.model !== undefined) fm.model = input.model;
  if (input.subtask !== undefined) fm.subtask = input.subtask;

  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}: ${serializeYamlScalar(value)}`);
  }
  lines.push('---', '', input.template.trim(), '');

  const path = commandPath(name);
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

/**
 * Read a managed command's frontmatter + body. Returns null when no managed
 * file exists for the name.
 */
export function readManagedCommand(
  name: string,
): { name: string; frontmatter: Record<string, unknown>; template: string } | null {
  const path = commandPath(validateCommandName(name));
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  return { name, frontmatter, template: body };
}

/**
 * Delete a managed command file. Returns true when a file was removed, false
 * when no managed file by that name existed (external/built-in → caller 400s).
 */
export function deleteManagedCommand(name: string): boolean {
  const path = commandPath(validateCommandName(name));
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

// ── tiny YAML frontmatter helpers (scalars only — commands never nest) ────────

function serializeYamlScalar(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const s = String(value);
  // Quote when the scalar contains characters that would confuse a bare YAML
  // reader (colon, leading special chars). Cheap + safe for command metadata.
  if (/[:#\n]/.test(s) || s.trim() !== s) return JSON.stringify(s);
  return s;
}

function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw.trim() };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: raw.trim() };
  const fmBlock = raw.slice(raw.indexOf('\n', 3) + 1, end);
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1).trim();
  const frontmatter: Record<string, unknown> = {};
  for (const line of fmBlock.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    const rawVal = line.slice(idx + 1).trim();
    frontmatter[key] = parseYamlScalar(rawVal);
  }
  return { frontmatter, body };
}

function parseYamlScalar(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
