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
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
  type AgentConfig,
} from '../repositories/agent_configs_repository';
import { expandProfileMcpAllowlist, expandProfileSkillAllowlist } from './agent_profile_scope';
// #1138 parse + projectable-value rules live in profile_capability_surface.ts so
// the readers of this surface (org optimizer) share ONE parse with this writer.
import {
  parseCorePermissions,
  withHardlineBashEscalation,
} from './profile_capability_surface';
import { opencodeClient } from './opencode_engine';

/**
 * #1039 — the fork memoizes its global config (agent registry) with an infinite
 * TTL, so a freshly written/edited/deleted agent `.md` is invisible to the
 * RUNNING engine until the next config.get() re-scan. Without this, promoting a
 * profile to `mode: all` rewrites the file correctly but `session.prompt(agent:
 * <id>)` still throws "Agent not found" against the stale registry. reloadConfig
 * (#948, POST /config/reload) invalidates that cache; it's non-throwing and
 * no-ops when the engine isn't ready. Fire-and-forget keeps writeAgentProfileFile
 * synchronous and never-throwing (its whole call-graph is sync/void).
 * ponytail: fire-and-forget — a sub-second write→trigger race is fine for the
 * designer-save→schedule flow; await + async ripple across ~15 call sites if a
 * caller ever needs the reload to have completed before it returns.
 */
function reloadEngineConfigAfterWrite(): void {
  // Pass the api_server cwd: headless/scheduled runs create their sessions
  // under effectiveCwd = process.cwd(), and the fork's reload is per-directory
  // instance state — a default-only reload leaves THAT instance's agent
  // registry stale (live-observed: promoted agent still "Agent not found").
  void opencodeClient.reloadConfig(process.cwd());
}

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
 * preamble makes direct work the default within the manager's own scope.
 * Exceptional delegation goes through the engine-native `task` tool (a real
 * subagent that nests under the caller in the UI) — NOT the `rhythm_delegate`
 * MCP tool, which creates an orphaned top-level session with no parent link
 * (#891). subagent_type selects an approved specialist; coding/dev work routes
 * to workflow-orchestrator, or coding-agent when the current profile is
 * workflow-orchestrator itself.
 */
export function buildHubRoutingPreamble(roster: string[], profileId?: string): string {
  const rosterList = roster.map((id) => `\`${id}\``).join(', ');
  const codingHandoff =
    profileId === 'workflow-orchestrator'
      ? WORKFLOW_ORCHESTRATOR_CODING_BODY
      : buildTaskDelegatePermissions(roster, profileId)['workflow-orchestrator'] === 'allow'
        ? CODING_HANDOFF_BODY
        : null;
  return (
    `${HUB_PREAMBLE_MARKER}\n` +
    'Handle the request directly when it fits your own role, system prompt, granted ' +
    'skills, tools, and permissions. Delegate only when the request is outside your ' +
    'direct scope; a specialist capability is materially required and you lack it; AJ ' +
    'explicitly requests delegation; or an independently owned parallel slice justifies ' +
    'delegation. Never delegate merely because an allowed specialist exists or shares ' +
    'the request topic.\n\n' +
    '**Exceptional delegation:** when one of those conditions applies, delegate to one ' +
    `of your approved specialists (${rosterList}) with the focused task as the ` +
    'prompt. Name the specialist explicitly; never use `"general"` as a fallback.\n\n' +
    '  - **In an interactive chat with AJ, use `rhythm_delegate_async`.** It returns ' +
    'immediately and pushes the specialist\'s result back into this session when it ' +
    'finishes, so you stay available for questions and new direction while the work ' +
    'runs. Do not sit and wait; acknowledge the dispatch and carry on. When the result ' +
    'arrives, report it once and stop — do not restate it.\n' +
    '  - **In a scheduled, headless, or system run, use the `task` tool** with ' +
    '`subagent_type` set to the specialist. `rhythm_delegate_async` is refused outside ' +
    'interactive chat by design, and blocking is fine there because nobody is waiting.\n' +
    '  - Use `task` with `explore` or `general` only for read-only fan-out inside your ' +
    'own scope — never to reach another profile.\n\n' +
    (codingHandoff ? `**Coding / development work:** ${codingHandoff}\n\n` : '') +
    'Direct work includes trivial admin, quick summaries, reading back information, and ' +
    'simple lookups, but is not limited to those tasks.'
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
        : null;
  if (!preamble) return body;
  const separator = body.length > 0 && !body.startsWith('\n') ? '\n\n' : '\n';
  return `${preamble}${separator}${body}`;
}

/**
 * Parse `config.allowedDelegatesJson` into a roster array for
 * `injectManagerPreamble`. Returns `[]` on missing/malformed/empty JSON so
 * callers always get a plain array to branch on (empty roster → the existing
 * dev-manager preamble; non-empty → the combined hub preamble).
 */
/**
 * #1322 Phase 3 — warn on a delegate id that resolves to no profile.
 *
 * `task` tolerated free-text agent names, so rosters accumulated non-canonical
 * entries: measured 2026-08-05, live history contained `Config Doctor` /
 * `Config-Doctor` alongside `config-doctor`, `AI Trend Researcher` vs
 * `AI-Trend-Researcher`, and raw UUIDs. Those silently authorize nothing —
 * `evaluate` simply never matches them — so a manager appears to have a delegate
 * it can never reach. Log it rather than fail the whole projection, which would
 * take an agent file down over one bad roster entry.
 */
function warnUnresolvableDelegates(config: AgentConfig, roster: string[]): void {
  if (roster.length === 0) return;
  let known: Set<string>;
  try {
    known = new Set(
      new AgentConfigsRepository().list().map((profile) => profile.id),
    );
  } catch {
    return; // never let a bookkeeping read break projection
  }
  const unresolvable = roster.filter((delegate) => !known.has(delegate));
  if (unresolvable.length > 0) {
    logger.warn(
      `[OpencodeAgentWriter] profile "${config.id}" lists delegate id(s) that match no ` +
        `agent profile and therefore authorize nothing: ${unresolvable.join(', ')}`,
    );
  }
}

function parseDelegateRoster(config: AgentConfig): string[] {
  if (!config.allowedDelegatesJson) return [];
  try {
    const parsed = JSON.parse(config.allowedDelegatesJson);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * Project a manager profile's delegate roster into opencode's task permission
 * map. The explicit catch-all denial is required so task authorization remains
 * fail-closed while each current delegate is allowed by its agent id.
 */
/**
 * Engine-native subagents that `task` is FOR: read-only fan-out inside one
 * profile. Distinct from crossing a profile boundary, which belongs to
 * rhythm_delegate / rhythm_delegate_async (#1322).
 *
 * Only these two are safe to name here. The other BUILTIN ids are primary or
 * internal agents (`build`, `plan`, `compaction`, `summary`, `title`), not
 * subagents. Neither `explore` nor `general` is ever projected as a Rhythm agent
 * file — BUILTIN_OPENCODE_AGENT_IDS excludes them from the writer — so these
 * names can only resolve to the engine's own agents, with no shadowing.
 */
export const TASK_NATIVE_SUBAGENTS = ['explore', 'general'] as const;

/**
 * `task` permissions for a profile: the native subagents always, plus an explicit
 * cross-profile roster for managers.
 *
 * Before #1322 this was only written for managers, so every NON-manager got no
 * `task` key at all and fell through to the engine's default `"*": "allow"` —
 * unrestricted delegation to any profile, the exact inverse of the intent. That is
 * how a UI/UX request reached the coding agent. Non-managers now get the natives
 * and nothing else.
 *
 * `selfId` is excluded even when a roster names it: self-delegation was 47 calls
 * (7.2%) of all cross-profile `task` traffic and is pure token burn, so a stale
 * roster entry must not reintroduce it.
 */
export function buildTaskDelegatePermissions(
  delegateRoster: string[],
  selfId?: string | null,
): Record<string, 'allow' | 'deny'> {
  const roster = delegateRoster.filter(
    (delegate) =>
      delegate.trim() !== '' &&
      delegate !== selfId &&
      // The roster is spread AFTER the natives below, so an entry naming an
      // engine built-in would override the `"*": "deny"` and grant it. Rhythm
      // does not delegate to `plan`, `build`, or the internal pipeline agents,
      // and `explore`/`general` are already granted as natives — so no roster
      // entry ever legitimately names a built-in. Dropping them here means a
      // stale or hand-edited allowed_delegates_json cannot reintroduce one.
      !BUILTIN_OPENCODE.has(delegate),
  );
  return {
    '*': 'deny',
    ...Object.fromEntries(TASK_NATIVE_SUBAGENTS.map((n) => [n, 'allow' as const])),
    ...Object.fromEntries(roster.map((delegate) => [delegate, 'allow' as const])),
  };
}

/** opencode built-in / internal agents — no source file; never write these. */
export const BUILTIN_OPENCODE_AGENT_IDS = [
  'build',
  'plan',
  'explore',
  'general',
  'compaction',
  'summary',
  'title',
] as const;

/** Legacy CLI model-selector presets — not opencode agents. */
export const CLI_MODEL_PRESET_IDS = ['claude-code', 'codex', 'gemini-cli', 'opencode'] as const;

const BUILTIN_OPENCODE = new Set<string>(BUILTIN_OPENCODE_AGENT_IDS);
const CLI_MODEL_PRESETS = new Set<string>(CLI_MODEL_PRESET_IDS);

export function isReservedAgentConfigId(id: string): boolean {
  return BUILTIN_OPENCODE.has(id) || CLI_MODEL_PRESETS.has(id);
}

/**
 * The only engine built-in a user may pick as a session agent.
 *
 * `build` is the engine's DEFAULT agent, and Rhythm deliberately falls back to
 * it for an agent-less session (see agent_sessions_controller), so it stays
 * selectable. Every other built-in is either an internal pipeline agent the
 * engine drives itself (`compaction`, `summary`, `title`), a primary mode Rhythm
 * does not use (`plan`), or a `task`-only subagent (`explore`, `general`) that is
 * a delegation target rather than something to start a conversation as.
 */
const SELECTABLE_BUILTIN_OPENCODE_AGENT_IDS = new Set<string>(['build']);

/**
 * Whether an engine-reported agent may be offered in Rhythm's agent list/picker.
 *
 * The engine's `GET /agent` returns all seven built-ins alongside Rhythm's own
 * projected profiles, and it does NOT set `builtIn` on them — so before this
 * filter existed they were indistinguishable from real Rhythm agents and all
 * seven appeared in the picker (measured live 2026-08-06: 43 entries including
 * `plan`, `compaction`, `summary`, `title`).
 *
 * Deliberately fail-CLOSED: anything in BUILTIN_OPENCODE_AGENT_IDS is hidden
 * unless explicitly allow-listed above, so a built-in added by a future engine
 * release stays out of the picker until someone decides it belongs there.
 * Non-built-in names (Rhythm's own profiles) always pass.
 */
export function isSelectableEngineAgent(name: string): boolean {
  return (
    !BUILTIN_OPENCODE.has(name) ||
    SELECTABLE_BUILTIN_OPENCODE_AGENT_IDS.has(name)
  );
}

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
 * True when a projectable profile is missing its on-disk `.md` file — the
 * #900 orphaned-duplicate symptom (a row inserted into `agent_configs`
 * without going through `writeAgentProfileFile`). Environment-gated the same
 * way as `shouldWriteAgentFile` so callers get a consistent "nothing to heal"
 * answer under postgres/test.
 */
export function isAgentProfileFileMissing(config: AgentConfig): boolean {
  if (!shouldWriteAgentFile(config)) return false;
  return !existsSync(agentFilePath(config.id));
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
  if (agentConfigExecutionBlockReason(config) !== null) return false;
  return isProjectableAgentConfigIgnoringEnabled(config);
}

/**
 * Same eligibility check as `isProjectableAgentConfig`, minus the `enabled`
 * gate — i.e. "would this row be a real opencode agent if it were enabled?"
 * #1135: used to find a DISABLED row that should still have its stale
 * `.md` deleted (both the state-aware PATCH writer and the sync's
 * delete-stale-on-disable reconcile pass need this "disabled but otherwise
 * projectable" question, as distinct from "should we write it" which is
 * always false once disabled).
 */
export function isProjectableAgentConfigIgnoringEnabled(config: AgentConfig): boolean {
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

/**
 * Encode a user-authored value as a YAML-safe double-quoted scalar. JSON
 * string syntax is valid YAML and protects leading `#`, colons, newlines, and
 * other label content from changing the frontmatter structure.
 */
export function yamlQuotedString(value: string): string {
  return JSON.stringify(value);
}

/** Replace a top-level `key: …` line in frontmatter, or append it if absent. */
function setFrontmatterKey(fm: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (re.test(fm)) return fm.replace(re, line);
  return fm.length > 0 ? `${fm}\n${line}` : line;
}

/** Quote permission keys that YAML would otherwise interpret as syntax. */
function yamlPermissionKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace one direct child of the top-level permission block, including every
 * deeper-indented line in its existing subtree.
 */
function replacePermissionSubtree(
  fm: string,
  key: string,
  replacement: string[],
): string {
  const lines = fm.split('\n');
  const permissionIndex = lines.findIndex((line) => /^permission:\s*$/.test(line));
  if (permissionIndex === -1) {
    return `${fm}${fm.length > 0 ? '\n' : ''}permission:\n${replacement.join('\n')}`;
  }

  let blockEnd = lines.length;
  for (let i = permissionIndex + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) {
      blockEnd = i;
      break;
    }
  }

  const keyPattern = new RegExp(
    `^  (?:${escapeRegExp(key)}|${escapeRegExp(JSON.stringify(key))}):`,
  );
  let existingStart = -1;
  let existingEnd = blockEnd;
  for (let i = permissionIndex + 1; i < blockEnd; i += 1) {
    if (keyPattern.test(lines[i])) {
      existingStart = i;
      existingEnd = i + 1;
      while (existingEnd < blockEnd && /^ {4}/.test(lines[existingEnd])) {
        existingEnd += 1;
      }
      break;
    }
  }

  lines.splice(
    existingStart === -1 ? blockEnd : existingStart,
    existingStart === -1 ? 0 : existingEnd - existingStart,
    ...replacement,
  );
  return lines.join('\n');
}

/** Ensure a scalar direct child exists inside the top-level permission block. */
function setPermissionKey(fm: string, key: string, value: string): string {
  return replacePermissionSubtree(fm, key, [
    `  ${yamlPermissionKey(key)}: ${value}`,
  ]);
}

function setPermissionValue(fm: string, key: string, value: unknown): string {
  if (typeof value === 'string') return setPermissionKey(fm, key, value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fm;
  return replacePermissionSubtree(fm, key, permissionBlockLines(key, value));
}

function permissionBlockLines(key: string, value: object): string[] {
  return [
    `  ${yamlPermissionKey(key)}:`,
    ...Object.entries(value).map(
      ([pattern, action]) => `    ${JSON.stringify(pattern)}: ${action}`,
    ),
  ];
}

/**
 * #1138 — remove every `permission:` sub-key NOT in `keep` from the existing
 * frontmatter, so a corrected/reduced config converges instead of accumulating
 * stale (or garbage) keys. A sub-key line is `  <key>:` at exactly two spaces of
 * indent; its nested pattern lines (deeper indent) are removed with it. If the
 * block ends up empty, the bare `permission:` header is dropped too. Never
 * touches any other (non-permission) top-level frontmatter. No-op when there is
 * no permission block.
 */
function pruneStalePermissionKeys(fm: string, keep: Set<string>): string {
  const lines = fm.split('\n');
  const permissionIndex = lines.findIndex((line) => /^permission:\s*$/.test(line));
  if (permissionIndex === -1) return fm;

  let blockEnd = lines.length;
  for (let i = permissionIndex + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) {
      blockEnd = i;
      break;
    }
  }

  const kept: string[] = [];
  let i = permissionIndex + 1;
  while (i < blockEnd) {
    const m = lines[i].match(/^  (\S[^:]*):/);
    if (m) {
      const key = m[1].startsWith('"') ? JSON.parse(m[1]) : m[1];
      // Collect this sub-key line plus its deeper-indented pattern lines.
      let j = i + 1;
      while (j < blockEnd && /^ {4}/.test(lines[j])) j += 1;
      if (keep.has(key)) kept.push(...lines.slice(i, j));
      i = j;
    } else {
      // A non-conforming line inside the block (blank, comment) — keep verbatim.
      kept.push(lines[i]);
      i += 1;
    }
  }

  const hasRealEntry = kept.some((l) => /^  \S/.test(l));
  const replacement = hasRealEntry ? ['permission:', ...kept] : [];
  lines.splice(permissionIndex, blockEnd - permissionIndex, ...replacement);
  return lines.join('\n');
}

/**
 * Outcome of a profile write. `blocked` and `failed` both mean the file on
 * disk is now stale; callers that can report to a user should say so rather
 * than treat the call as a success.
 */
export type AgentProfileWriteResult = 'written' | 'skipped' | 'blocked' | 'failed';

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
 *
 * The returned status exists because that log line was the *only* signal: a
 * blocked write left the file stale while the HTTP caller still saw 200. The
 * status never carries the scanned content — only the fact that it was
 * rejected.
 */
export function writeAgentProfileFile(config: AgentConfig): AgentProfileWriteResult {
  if (!shouldWriteAgentFile(config)) return 'skipped';
  if (config.systemPrompt && config.systemPrompt.trim() !== '') {
    const scan = scanContextContent(config.systemPrompt, `agent profile "${config.id}"`);
    if (scan.blocked) {
      logger.warn(`[OpencodeAgentWriter] ${scan.warning}`);
      return 'blocked';
    }
  }
  try {
    const dir = agentsDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const path = agentFilePath(config.id);
    // #1039/#1088: a SCHEDULABLE profile is written `all` (not `primary`).
    // opencode's mode enum is ["subagent","primary","all"] (agent/agent.ts) and
    // `all` makes the agent usable BOTH as a top-level primary — so AgentRunner
    // can run it headless via `agent: <id>` (a scheduled/background run) — AND as
    // a delegation target for the `task` tool. Writing `primary` would make a
    // schedulable specialist top-level-runnable but is the wrong idiom for one
    // that is ALSO a delegate; `all` covers both roles so promoting a profile to
    // schedulable never removes it as a delegation target. `subagent` (delegation
    // only) is kept for non-schedulable profiles — and scheduling one of those is
    // now blocked at config time (agentSchedulesController), because opencode
    // won't resolve a subagent-mode agent as a top-level `agent:` target (throws
    // "Agent not found") → the old silent "model produced no output".
    //
    // #1088: `config.schedulable` is picker-INDEPENDENT — it falls back to
    // `sessionSelectable` when no explicit override is stored (see
    // agent_configs_repository's rowToModel), so a hidden specialist
    // (sessionSelectable=false) with an explicit schedulable=true override is
    // written `all` — top-level-runnable AND delegatable — while remaining
    // absent from the Flutter picker, which reads sessionSelectable only.
    const mode = (config.schedulable ?? config.sessionSelectable) ? 'all' : 'subagent';
    const model =
      config.modelProvider && config.modelId
        ? `${config.modelProvider}/${config.modelId}`
        : null;

    let fm: string;
    let body: string;

    // #1322 — force the hardline-blocklist command shapes to escalate, so
    // Rhythm's gate actually sees them instead of the engine running them under
    // a profile's `bash {"*": "allow"}`. Applied here, before the projection
    // loop, so it flows through the prune/keep bookkeeping unchanged (`bash`
    // stays a single top-level permission key).
    const corePermissions = withHardlineBashEscalation(parseCorePermissions(config));

    if (existsSync(path)) {
      // Merge: preserve unmanaged frontmatter + keep body when no new prompt.
      const [existingFm, existingBody] = splitFrontmatter(readFileSync(path, 'utf8'));
      fm = existingFm ?? '';
      // description: only seed when missing — preserve a richer existing one.
      if (!/^description:.*$/m.test(fm)) {
        fm = setFrontmatterKey(fm, 'description', yamlQuotedString(config.label));
      }
      fm = setFrontmatterKey(fm, 'mode', mode);
      if (model) fm = setFrontmatterKey(fm, 'model', model);
      body = config.systemPrompt && config.systemPrompt.trim() !== ''
        ? config.systemPrompt
        : existingBody;

      // #1138 — the merge path used to only UPSERT permission keys, never
      // remove ones no longer in the config, so a file once polluted with
      // stale/garbage keys never converged even after the config was corrected.
      // Prune every existing `permission:` sub-key that this projection will
      // NOT re-write — i.e. not in the current corePermissions and not one of
      // the writer-injected keys (image_generation / task / write) appended
      // below. Those injected keys are conditional, so a profile that stops
      // being a manager (task) or loses image_generation also sheds them.
      const keep = new Set<string>(Object.keys(corePermissions));
      if (config.imageGenerationEnabled === true) keep.add('image_generation');
      keep.add('task'); // #1322 — projected for every profile now
      keep.add('rhythm_delegate_async');
      if (config.id === 'workflow-orchestrator') keep.add('write');
      fm = pruneStalePermissionKeys(fm, keep);
    } else {
      // Fresh file authored from the profile.
      fm = `description: ${yamlQuotedString(config.label)}\nmode: ${mode}`;
      if (model) fm += `\nmodel: ${model}`;
      body = config.systemPrompt ?? '';
    }

    for (const [permission, action] of Object.entries(corePermissions)) {
      fm = setPermissionValue(fm, permission, action);
    }
    // #1094 — OpenAI native image_generation grant. A dedicated capability
    // flag (not an MCP allowlist entry), projected as the same permission-key
    // mechanism every other tool uses so the existing ask/allow/deny approval
    // flow applies uniformly. Written AFTER the corePermissionsJson loop so
    // an explicit `image_generation` entry there (if the profile ever sets
    // one directly) is not silently clobbered when the flag is also true —
    // last-match-wins means this only overrides when the flag disagrees.
    // Absence when false (never writes 'deny') keeps a profile's own explicit
    // corePermissionsJson override authoritative.
    if (config.imageGenerationEnabled === true) {
      fm = setPermissionKey(fm, 'image_generation', 'allow');
    }
    const delegateRoster = parseDelegateRoster(config);
    warnUnresolvableDelegates(config, delegateRoster);
    // #1322 — ALWAYS written. A non-manager previously got no `task` key and
    // inherited the engine default `"*": "allow"`.
    fm = setPermissionValue(
      fm,
      'task',
      buildTaskDelegatePermissions(config.isManager === true ? delegateRoster : [], config.id),
    );
    // #1123 — expose the additive async delegate tool only to manager profiles
    // that can own an interactive chat. Runtime API validation repeats the
    // interactive/session gate so a profile that is also schedulable cannot use
    // this from a headless run. An explicit corePermissionsJson entry remains
    // authoritative for eligible managers; every ineligible profile is forced
    // deny so the schema is unavailable before dispatch.
    if (config.isManager === true && config.sessionSelectable) {
      if (corePermissions.rhythm_delegate_async === undefined) {
        fm = setPermissionKey(fm, 'rhythm_delegate_async', 'allow');
      }
    } else {
      fm = setPermissionKey(fm, 'rhythm_delegate_async', 'deny');
    }
    if (config.id === 'workflow-orchestrator') {
      fm = setPermissionKey(fm, 'write', 'allow');
    }
    // #1012: project the profile's expanded MCP allowlist so the engine loads it
    // into `agent.options.mcpAllowlist`. The `task` tool reads that to scope a
    // subagent session spawned via delegation (that path never round-trips
    // through the api_server expander). Scoped profiles only; an unscoped
    // profile (allowedMcpsJson=null) omits it → child keeps the engine's
    // back-compat "all tools" default. Single-line flow YAML (JSON is valid
    // YAML) — assumes no pre-existing multi-line `options:` block (none today).
    const childMcpAllowlist = expandProfileMcpAllowlist(
      config.allowedMcpsJson ?? null,
      config.id,
      config.label,
    );
    // Mirror #1012 for skills: project the profile's expanded skill allowlist so
    // task.ts reads options.skillAllowlist onto delegated child sessions (that
    // path never round-trips through ws_gateway's per-turn PATCH). Unscoped
    // profile (allowedSkillsJson=null) → undefined → key omitted.
    const childSkillAllowlist = expandProfileSkillAllowlist(config.allowedSkillsJson ?? null);
    const options: Record<string, unknown> = {};
    if (childMcpAllowlist) options.mcpAllowlist = childMcpAllowlist;
    if (childSkillAllowlist) options.skillAllowlist = childSkillAllowlist;
    // #1118 — per-profile reasoning effort. session/llm.ts merges
    // `agent.options` directly into the AI SDK call options (mergeOptions
    // chain in packages/opencode/src/session/llm.ts), which is exactly where
    // the engine's own `variants()` table places a selected variant's
    // `effort` key for Anthropic adaptive models — so `options.effort` here
    // reaches the request the same way, without requiring a session-level
    // variant pick. rhythm-anthropic-accounts' transforms.js strips it again
    // for models that reject it (haiku).
    if (config.reasoningEffort) options.effort = config.reasoningEffort;
    if (Object.keys(options).length > 0) {
      fm = setFrontmatterKey(fm, 'options', JSON.stringify(options));
    }
    body = injectManagerPreamble(
      body,
      config.isManager === true,
      delegateRoster,
      config.id,
    );

    const out = `---\n${fm}\n---\n${body.startsWith('\n') ? body.slice(1) : body}`;
    writeFileSync(path, out.endsWith('\n') ? out : `${out}\n`, 'utf8');
    logger.info(`[OpencodeAgentWriter] wrote agent file for profile "${config.id}"`);
    reloadEngineConfigAfterWrite();
    return 'written';
  } catch (err) {
    logger.warn(`[OpencodeAgentWriter] write failed for "${config.id}": ${String(err)}`);
    return 'failed';
  }
}

/**
 * Whether a projected agent file is currently on disk. Unlike
 * `isAgentProfileFileMissing`, this asks about the FILE, not about whether the
 * profile ought to have one — a caller that just deleted a stale file for a
 * disabled profile has to be able to prove the delete stuck.
 */
export function agentProfileFileExists(id: string): boolean {
  if (env.dbClient === 'postgres') return false;
  if (isTestEnv()) return false;
  // Same exclusion `deleteAgentProfileFile` applies: a CLI preset or engine
  // builtin owns its file, and we neither write nor remove it. Without this the
  // two disagree — the delete no-ops, the existence check says the file is
  // still there, and the caller reports `failed` forever for a file that was
  // never ours to touch.
  if (CLI_MODEL_PRESETS.has(id) || BUILTIN_OPENCODE.has(id)) return false;
  try {
    return existsSync(agentFilePath(id));
  } catch {
    return false;
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
      reloadEngineConfigAfterWrite();
    }
  } catch (err) {
    logger.warn(`[OpencodeAgentWriter] delete failed for "${id}": ${String(err)}`);
  }
}

/**
 * State-aware save for the PATCH path — #1135 (CWE-284/CWE-672): a profile
 * flipped to `enabled: false` must have its projected `.md` DELETED, not left
 * on disk. `writeAgentProfileFile` alone can't do this: it early-returns via
 * `shouldWriteAgentFile` the moment `enabled` is false, so it never reaches
 * the code that would remove the existing file — a disabled profile's old
 * model/prompt/permissions stayed live and loadable by the engine
 * indefinitely. Call this instead of `writeAgentProfileFile` anywhere a saved
 * profile's `enabled` state may have just changed.
 */
export function syncAgentProfileFileForState(config: AgentConfig): void {
  if (
    agentConfigExecutionBlockReason(config) !== null &&
    isProjectableAgentConfigIgnoringEnabled(config)
  ) {
    deleteAgentProfileFile(config.id);
    return;
  }
  writeAgentProfileFile(config);
}
