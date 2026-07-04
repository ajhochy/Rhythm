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
import { scanContextContent } from '../security/context_scanner';
import type { AgentConfig } from '../repositories/agent_configs_repository';

/**
 * Prepended to a manager-profile body WITHOUT a delegate roster so that the
 * orchestrator role is explicit to opencode when it loads the file. Must
 * appear exactly once. workflow-orchestrator gets a profile-aware variant
 * below so it never delegates to itself.
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

/** Idempotency marker: substring whose presence means the plain preamble is already there. */
const PREAMBLE_MARKER = '## Routing (mandatory)';

/**
 * Idempotency marker for the COMBINED (hub) preamble — used by managers that
 * carry a non-empty `allowedDelegates` roster (e.g. Secretary). Distinct from
 * `PREAMBLE_MARKER` so the two variants never collide or duplicate on re-write.
 */
const HUB_PREAMBLE_MARKER = '## Routing (mandatory — hub)';

/**
 * Coding hand-off section reused verbatim (content, not heading) inside the
 * combined hub preamble — see `buildHubRoutingPreamble`.
 */
const CODING_HANDOFF_BODY =
  'For any coding, development, implementation, debugging, refactor, or PR/issue task, ' +
  'you MUST hand off to the workflow-orchestrator by calling the `task` tool with ' +
  '`subagent_type="workflow-orchestrator"` — name that delegate explicitly; never use ' +
  '`"general"` and never omit `subagent_type`. Do this regardless of how the request is ' +
  'phrased.';

const WORKFLOW_ORCHESTRATOR_CODING_BODY =
  'Own the coding workflow in this session. Delegate implementation work through the ' +
  '`task` tool with `subagent_type="coding-agent"` and use the other approved workflow ' +
  'specialists for planning, verification, failure triage, and project-state updates. ' +
  'Never delegate to `workflow-orchestrator` from workflow-orchestrator itself.';

/**
 * Build the combined routing preamble for a manager that has a non-empty
 * `allowedDelegates` roster (a "hub" manager, e.g. Secretary). Unlike the
 * plain `MANAGER_ROUTING_PREAMBLE` (dev-only manager, no roster), this
 * preamble routes ALL work rather than handling non-dev tasks itself. BOTH
 * domain and coding work go through the engine-native `task` tool (a real
 * subagent that nests under the caller in the UI) — NOT the `rhythm_delegate`
 * MCP tool, which creates an orphaned top-level session with no parent link
 * (#891). subagent_type selects the specialist:
 *   (a) domain/ministry work → `task` with `subagent_type=<specialist>`
 *   (b) coding/dev work → workflow-orchestrator, or coding-agent when the
 *       current profile is workflow-orchestrator itself
 *   (c) only trivial admin/summarize/read work is handled directly
 */
export function buildHubRoutingPreamble(roster: string[], profileId?: string): string {
  const rosterList = roster.map((id) => `\`${id}\``).join(', ');
  const codingHandoff =
    profileId === 'workflow-orchestrator'
      ? WORKFLOW_ORCHESTRATOR_CODING_BODY
      : CODING_HANDOFF_BODY;
  return (
    `${HUB_PREAMBLE_MARKER}\n` +
    'You are a routing hub. Do not attempt domain or coding work yourself — route it ' +
    'through the `task` tool so the delegated run appears as a subagent under this ' +
    'session.\n\n' +
    '**Domain / ministry work:** delegate to the fitting specialist by calling the ' +
    '`task` tool with `subagent_type` set to one of your approved specialists ' +
    `(${rosterList}) and the focused task as the prompt. Name the specialist ` +
    'explicitly; never use `"general"` and never omit `subagent_type`. Pick whichever ' +
    'specialist fits the request, delegate, then summarize the result for the user.\n\n' +
    `**Coding / development work:** ${codingHandoff}\n\n` +
    'Only handle trivial admin yourself — quick summaries, reading back information, or ' +
    'simple lookups that do not require a specialist or the coding workflow.'
  );
}

/**
 * If `isManager` is true, prepend the appropriate routing preamble:
 *  - a non-empty `delegateRoster` → the combined hub preamble (routes BOTH
 *    domain work via `rhythm_delegate` and coding work via the dev hand-off).
 *  - no roster → the existing plain `MANAGER_ROUTING_PREAMBLE` (coding hand-off
 *    only), except workflow-orchestrator receives its self-safe variant.
 * No-op for non-managers. Idempotent: re-injecting either variant does not
 * duplicate it, and injecting one variant when the other is already present
 * is a no-op too (only one routing preamble should ever apply to a profile).
 *
 * Exported for unit testing — callers outside this module should not need it.
 */
export function injectManagerPreamble(
  body: string,
  isManager: boolean,
  delegateRoster: string[] = [],
  profileId?: string,
): string {
  if (!isManager) return body;
  if (body.includes(PREAMBLE_MARKER) || body.includes(HUB_PREAMBLE_MARKER)) return body;

  const preamble =
    delegateRoster.length > 0
      ? buildHubRoutingPreamble(delegateRoster, profileId)
      : profileId === 'workflow-orchestrator'
        ? `${PREAMBLE_MARKER}\n${WORKFLOW_ORCHESTRATOR_CODING_BODY}`
        : MANAGER_ROUTING_PREAMBLE;
  const separator = body.length > 0 && !body.startsWith('\n') ? '\n\n' : '\n';
  return `${preamble}${separator}${body}`;
}

/**
 * Parse `config.allowedDelegatesJson` into a roster array for
 * `injectManagerPreamble`. Returns `[]` on missing/malformed/empty JSON so
 * callers always get a plain array to branch on (empty roster → the existing
 * dev-manager preamble; non-empty → the combined hub preamble).
 */
function parseDelegateRoster(config: AgentConfig): string[] {
  if (!config.allowedDelegatesJson) return [];
  try {
    const parsed = JSON.parse(config.allowedDelegatesJson);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string') ? parsed : [];
  } catch {
    return [];
  }
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
 * True when this profile IS (or should become) a real opencode agent,
 * independent of environment side-effect gating (test/postgres). Excludes CLI
 * model-selector presets and opencode built-ins (see module doc) — those are
 * never projected as opencode agent files and never carry a real engine name.
 *
 * Pure — safe to call from contexts that need the eligibility question
 * answered without triggering (or being blocked by) the file-write guards
 * below, e.g. agent_profile_sync's #858 oc_agent backfill pass.
 */
export function isProjectableAgentConfig(config: AgentConfig): boolean {
  if (!config.isAgent) return false;
  if (CLI_MODEL_PRESETS.has(config.id)) return false;
  if ((config.presetId ?? '') !== '' && CLI_MODEL_PRESETS.has(config.presetId!)) {
    return false;
  }
  if (BUILTIN_OPENCODE.has(config.id)) return false;
  return true;
}

/**
 * True when this profile should be projected to an opencode agent file.
 * Excludes CLI model presets and opencode built-ins (see module doc), and
 * additionally gates on environment (no writes under test, no local opencode
 * engine under Postgres).
 */
export function shouldWriteAgentFile(config: AgentConfig): boolean {
  if (env.dbClient === 'postgres') return false;
  if (isTestEnv()) return false;
  return isProjectableAgentConfig(config);
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

/** Ensure a direct child entry exists inside the top-level permission block. */
function setPermissionKey(fm: string, key: string, value: string): string {
  const lines = fm.split('\n');
  const permissionIndex = lines.findIndex((line) => /^permission:\s*$/.test(line));
  if (permissionIndex === -1) {
    return `${fm}${fm.length > 0 ? '\n' : ''}permission:\n  ${key}: ${value}`;
  }

  let blockEnd = lines.length;
  for (let i = permissionIndex + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) {
      blockEnd = i;
      break;
    }
  }

  const keyPattern = new RegExp(`^  ${key}:`);
  const existingIndex = lines
    .slice(permissionIndex + 1, blockEnd)
    .findIndex((line) => keyPattern.test(line));
  if (existingIndex >= 0) {
    lines[permissionIndex + 1 + existingIndex] = `  ${key}: ${value}`;
  } else {
    lines.splice(blockEnd, 0, `  ${key}: ${value}`);
  }
  return lines.join('\n');
}

/**
 * Write (or merge-update) the opencode agent file for a profile. Never throws —
 * failures degrade to a logged warning. No-op when the profile is out of scope.
 *
 * #873: `config.systemPrompt` is user-authored text that becomes the agent's
 * system prompt the moment the engine loads this file — exactly the
 * "context file loaded into the agent's prompt" case the issue targets. It is
 * scanned before the write; a high-confidence match skips the write entirely
 * (degrading to the same logged-warning outcome as any other write failure,
 * per this function's existing never-throws contract) rather than silently
 * projecting a hijacked prompt into a file the engine will load.
 */
export function writeAgentProfileFile(config: AgentConfig): void {
  if (!shouldWriteAgentFile(config)) return;
  if (config.systemPrompt && config.systemPrompt.trim() !== '') {
    const scan = scanContextContent(config.systemPrompt, `agent profile "${config.id}"`);
    if (scan.blocked) {
      logger.warn(`[OpencodeAgentWriter] ${scan.warning}`);
      return;
    }
  }
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

    if (config.id === 'workflow-orchestrator') {
      fm = setPermissionKey(fm, 'write', 'allow');
    }
    body = injectManagerPreamble(
      body,
      config.isManager === true,
      parseDelegateRoster(config),
      config.id,
    );

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
