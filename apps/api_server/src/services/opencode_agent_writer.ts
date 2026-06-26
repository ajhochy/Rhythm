/**
 * Opencode Agent Writer — Agent Profile → opencode `.md` (consolidation)
 *
 * Makes the Agent Profile the source of truth: whenever a profile is saved in
 * the designer, project it out to an opencode agent definition file at
 * ~/.config/opencode/agents/<id>.md so opencode can run it by name. On delete,
 * the file is removed.
 *
 * Scope (full ownership, but two tiers are intentionally NOT written):
 *  • CLI model presets (claude-code / codex / gemini-cli / opencode) — these are
 *    model selectors, not opencode agents. Writing them would leak them into the
 *    composer agent picker via the mirror sync.
 *  • opencode built-in/internal agents (build, plan, explore, general,
 *    compaction, summary, title) — these have no source file; writing one would
 *    override opencode's built-in behavior.
 *
 * Merge strategy: when a file already exists (e.g. an agent-stack-synced workflow
 * agent), only the managed frontmatter keys (description, mode, model) are
 * updated and the body is replaced with the profile's systemPrompt. Any other
 * frontmatter (permission blocks, color, options, …) is preserved verbatim, and
 * the existing body is kept when the profile has no systemPrompt — so a save can
 * never silently erase an agent's prompt or permissions.
 *
 * Local SQLite only — production Postgres has no local opencode engine.
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import type { AgentConfig } from '../repositories/agent_configs_repository';

/**
 * Prepended to every manager-profile body so that the orchestrator role is
 * explicit to opencode when it loads the file. Must appear exactly once.
 * The distinctive heading "## Routing (mandatory)" is used as the idempotency
 * marker — see `injectManagerPreamble`.
 */
export const MANAGER_ROUTING_PREAMBLE =
  '## Routing (mandatory)\n' +
  'For any coding, development, implementation, debugging, refactor, or PR/issue task, ' +
  'you MUST hand off to the workflow-orchestrator by calling the `task` tool with ' +
  '`subagent_type="workflow-orchestrator"` — name that delegate explicitly; never use ' +
  '`"general"` and never omit `subagent_type`. Do this regardless of how the request is ' +
  'phrased. Only handle non-development tasks yourself.';

/** Idempotency marker: substring whose presence means the preamble is already there. */
const PREAMBLE_MARKER = '## Routing (mandatory)';

/**
 * If `isManager` is true and the preamble is not already in `body`, prepend
 * `MANAGER_ROUTING_PREAMBLE` followed by a blank line. No-op for non-managers
 * and when the marker is already present (idempotent re-write safety).
 *
 * Exported for unit testing — callers outside this module should not need it.
 */
export function injectManagerPreamble(body: string, isManager: boolean): string {
  if (!isManager) return body;
  if (body.includes(PREAMBLE_MARKER)) return body;
  const separator = body.length > 0 && !body.startsWith('\n') ? '\n\n' : '\n';
  return `${MANAGER_ROUTING_PREAMBLE}${separator}${body}`;
}

/** opencode built-in / internal agents — no source file; never write these. */
const BUILTIN_OPENCODE = new Set([
  'build',
  'plan',
  'explore',
  'general',
  'compaction',
  'summary',
  'title',
]);

/** Legacy CLI model-selector presets — not opencode agents. */
const CLI_MODEL_PRESETS = new Set(['claude-code', 'codex', 'gemini-cli', 'opencode']);

/**
 * Never touch the real ~/.config/opencode/agents directory from a test run.
 * vitest exercises the agent-configs CRUD with throwaway fixtures; without this
 * guard those writes would pollute the user's actual opencode agent dir.
 */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function agentsDir(): string {
  return join(homedir(), '.config', 'opencode', 'agents');
}

function agentFilePath(id: string): string {
  return join(agentsDir(), `${id}.md`);
}

/**
 * True when this profile should be projected to an opencode agent file.
 * Excludes CLI model presets and opencode built-ins (see module doc).
 */
export function shouldWriteAgentFile(config: AgentConfig): boolean {
  if (env.dbClient === 'postgres') return false;
  if (isTestEnv()) return false;
  if (!config.isAgent) return false;
  if (CLI_MODEL_PRESETS.has(config.id)) return false;
  if ((config.presetId ?? '') !== '' && CLI_MODEL_PRESETS.has(config.presetId!)) {
    return false;
  }
  if (BUILTIN_OPENCODE.has(config.id)) return false;
  return true;
}

/** Split a `.md` into [frontmatterText, body]. Returns [null, fullText] if none. */
function splitFrontmatter(text: string): [string | null, string] {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return [null, text];
  return [m[1], m[2]];
}

/** Replace a top-level `key: …` line in frontmatter, or append it if absent. */
function setFrontmatterKey(fm: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (re.test(fm)) return fm.replace(re, line);
  return fm.length > 0 ? `${fm}\n${line}` : line;
}

/**
 * Write (or merge-update) the opencode agent file for a profile. Never throws —
 * failures degrade to a logged warning. No-op when the profile is out of scope.
 */
export function writeAgentProfileFile(config: AgentConfig): void {
  if (!shouldWriteAgentFile(config)) return;
  try {
    const dir = agentsDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const path = agentFilePath(config.id);
    const mode = config.sessionSelectable ? 'primary' : 'subagent';
    const model =
      config.modelProvider && config.modelId
        ? `${config.modelProvider}/${config.modelId}`
        : null;

    let fm: string;
    let body: string;

    if (existsSync(path)) {
      // Merge: preserve unmanaged frontmatter + keep body when no new prompt.
      const [existingFm, existingBody] = splitFrontmatter(readFileSync(path, 'utf8'));
      fm = existingFm ?? '';
      // description: only seed when missing — preserve a richer existing one.
      if (!/^description:.*$/m.test(fm)) {
        fm = setFrontmatterKey(fm, 'description', config.label);
      }
      fm = setFrontmatterKey(fm, 'mode', mode);
      if (model) fm = setFrontmatterKey(fm, 'model', model);
      body = config.systemPrompt && config.systemPrompt.trim() !== ''
        ? config.systemPrompt
        : existingBody;
    } else {
      // Fresh file authored from the profile.
      fm = `description: ${config.label}\nmode: ${mode}`;
      if (model) fm += `\nmodel: ${model}`;
      body = config.systemPrompt ?? '';
    }

    body = injectManagerPreamble(body, config.isManager === true);

    const out = `---\n${fm}\n---\n${body.startsWith('\n') ? body.slice(1) : body}`;
    writeFileSync(path, out.endsWith('\n') ? out : `${out}\n`, 'utf8');
    logger.info(`[OpencodeAgentWriter] wrote agent file for profile "${config.id}"`);
  } catch (err) {
    logger.warn(`[OpencodeAgentWriter] write failed for "${config.id}": ${String(err)}`);
  }
}

/** Remove the opencode agent file for a deleted profile. Never throws. */
export function deleteAgentProfileFile(id: string): void {
  if (env.dbClient === 'postgres') return;
  if (isTestEnv()) return;
  if (CLI_MODEL_PRESETS.has(id) || BUILTIN_OPENCODE.has(id)) return;
  try {
    const path = agentFilePath(id);
    if (existsSync(path)) {
      rmSync(path);
      logger.info(`[OpencodeAgentWriter] removed agent file for profile "${id}"`);
    }
  } catch (err) {
    logger.warn(`[OpencodeAgentWriter] delete failed for "${id}": ${String(err)}`);
  }
}
