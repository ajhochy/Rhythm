/**
 * profile_capability_surface.ts — the NON-MCP half of a profile's tool scope.
 *
 * A profile grants tools through two unrelated surfaces:
 *
 *   1. MCP servers — `allowed_mcps_json`
 *      (see `agent_profile_scope.resolveProfileMcpScope`).
 *   2. Core + provider-EXECUTED tools — `core_permissions_json`, plus the
 *      dedicated `image_generation_enabled` flag (#1094). `image_generation` is
 *      NOT an MCP server: it is executed by the model provider and granted by a
 *      `permission.image_generation` entry / that per-profile flag. It can never
 *      appear in, or be granted by, an MCP allowlist.
 *
 * The org optimizer used to look for image generation in the MCP allowlist,
 * find nothing (of course), and file a high-risk "this agent lacks image
 * generation" proposal against a profile whose `imageGenerationEnabled` was
 * already `true`. Every capability in `CORE_PERMISSION_NAMES` sits in exactly
 * that position — searchable only on this surface — so this module answers
 * "does the profile already have capability X?" for ALL of them, not just the
 * one that produced the bad proposal.
 *
 * `parseCorePermissions` / `isProjectablePermissionValue` were MOVED here from
 * `opencode_agent_writer.ts` (which now imports them) so the projector and the
 * readers share one parse of `core_permissions_json`.
 */

import { logger } from '../utils/logger';
import { CORE_PERMISSION_NAMES } from './org_diagnosis_types';
import type { AgentConfig } from '../repositories/agent_configs_repository';

/** The three actions opencode's permission schema accepts (permission.ts). */
export const VALID_PERMISSION_ACTIONS = new Set(['allow', 'ask', 'deny']);

/**
 * A corePermissions ENTRY value is projectable iff it is either a plain action
 * string ('allow'|'ask'|'deny') or a flat {pattern: action} map whose every
 * value is such an action. This is the exact shape the engine's `permission:`
 * frontmatter block expects (and the same contract the REST validator in
 * agent_configs_controller.ts enforces on write). #1138: the old Tool
 * Permissions panel could persist an INDEXED-LIST shape
 * ({"0":{permission,pattern,action},...}) whose values are objects of
 * NON-action values; projecting those verbatim produced numbered garbage
 * frontmatter keys and a bare `"permission": *` line that is invalid YAML.
 */
export function isProjectablePermissionValue(value: unknown): value is string | Record<string, string> {
  if (typeof value === 'string') return VALID_PERMISSION_ACTIONS.has(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([pattern, action]) =>
      pattern.trim().length > 0 && typeof action === 'string' && VALID_PERMISSION_ACTIONS.has(action),
  );
}

/**
 * Parse a profile's corePermissionsJson into the flat map the projector loops
 * over. #1138: fail-SOFT per entry — an entry whose value doesn't match the
 * {permissionName: action | {pattern: action}} shape is logged and SKIPPED
 * rather than projected as raw garbage that can break the whole file's YAML.
 * (Malformed JSON, or a non-object top level, still yields {} as before.)
 */
/**
 * Bash command shapes that MUST reach Rhythm's command-approval gate.
 *
 * #1322: Rhythm's hardline blocklist only ever sees commands the ENGINE decides
 * to ask about. Nearly every profile carries `bash: {"*": "allow", …}`, so
 * anything matching only `*` was executed with no permission event at all and
 * the blocklist — documented as non-overridable — never ran. `rm -rf*` and
 * `sudo *` were already escalated by hand; these were not.
 *
 * A bare `sh` / `bash` / `zsh` is the pipe-to-shell signature: the engine splits
 * `curl URL | sh` into command nodes and evaluates each, so the bare interpreter
 * IS the segment to catch. Engine patterns are fully anchored (`^…$` in
 * util/wildcard.ts), so `sh` matches only a bare `sh` and never `sh deploy.sh`.
 *
 * Escalating to `ask` is not the same as denying: Rhythm still decides, and an
 * unattended run auto-allows a non-hardline `ask` rather than hanging. The only
 * behavior change for a safe command is that Rhythm gets to look at it.
 */
export const HARDLINE_ESCALATION_BASH_RULES: ReadonlyArray<{
  pattern: string;
  /** A command that pattern is meant to catch, used to read the current action. */
  probe: string;
}> = Object.freeze([
  { pattern: 'sh', probe: 'sh' },
  { pattern: 'bash', probe: 'bash' },
  { pattern: 'zsh', probe: 'zsh' },
  { pattern: 'mkfs*', probe: 'mkfs.ext4 /dev/disk2' },
  { pattern: 'dd *', probe: 'dd if=/dev/zero of=/dev/disk0' },
]);

/**
 * The engine's pattern matcher, mirrored from
 * apps/opencode_fork/packages/opencode/src/util/wildcard.ts so this module can
 * ask "what would the engine already do with this command?" without guessing.
 * Fully anchored, `*` → `.*`, and a trailing " *" made optional.
 */
function engineMatch(command: string, pattern: string): boolean {
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  if (escaped.endsWith(' .*')) escaped = escaped.slice(0, -3) + '( .*)?';
  return new RegExp('^' + escaped + '$', 's').test(command);
}

/** The action the engine would pick for `command` — last matching rule wins. */
function effectiveAction(command: string, rules: Record<string, string>): string | undefined {
  return Object.entries(rules)
    .filter(([pattern]) => engineMatch(command, pattern))
    .pop()?.[1];
}

/**
 * Force the hardline-blocklist command shapes to escalate, but ONLY where the
 * profile would otherwise let them run.
 *
 * Appended LAST on purpose: the engine resolves a command with `findLast` over
 * the flattened ruleset (permission/evaluate.ts), so later entries win. That is
 * the same mechanism that already lets `git push*: ask` beat `*: allow`.
 *
 * **Never downgrades.** An entry is added only when the current effective action
 * for that shape is `allow`; a profile that already says `deny` or `ask` is left
 * exactly as authored. Rewriting `bash: "deny"` into
 * `{'*': 'deny', sh: 'ask', …}` would turn a total denial into a prompt — the
 * opposite of the point — and would also break #1162's "a scalar replaces the
 * whole subtree" contract. A profile with no `bash` key is likewise untouched:
 * `evaluate` already defaults an unmatched command to `ask`.
 */
export function withHardlineBashEscalation(
  permissions: Record<string, string | Record<string, string>>,
): Record<string, string | Record<string, string>> {
  const bash = permissions.bash;
  if (bash === undefined) return permissions;
  const current: Record<string, string> = typeof bash === 'string' ? { '*': bash } : bash;

  const additions: Record<string, string> = {};
  for (const { pattern, probe } of HARDLINE_ESCALATION_BASH_RULES) {
    if (effectiveAction(probe, current) === 'allow') additions[pattern] = 'ask';
  }
  // Nothing runs today that shouldn't — leave the profile byte-identical so a
  // scalar stays a scalar.
  if (Object.keys(additions).length === 0) return permissions;

  return { ...permissions, bash: { ...current, ...additions } };
}

export function parseCorePermissions(
  config: Pick<AgentConfig, 'id' | 'corePermissionsJson'>,
): Record<string, string | Record<string, string>> {
  if (!config.corePermissionsJson) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(config.corePermissionsJson);
  } catch (err) {
    logger.warn(`[OpencodeAgentWriter] invalid corePermissionsJson for "${config.id}": ${String(err)}`);
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const clean: Record<string, string | Record<string, string>> = {};
  for (const [permission, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (permission.trim() && isProjectablePermissionValue(value)) {
      clean[permission] = value;
    } else {
      logger.warn(
        `[OpencodeAgentWriter] skipping malformed corePermissions entry "${permission}" for "${config.id}" ` +
          `(not an action string or {pattern: action} map)`,
      );
    }
  }
  return clean;
}

/** The profile's resolved non-MCP capability layer. */
export interface CoreCapabilitySurface {
  /**
   * capability name → its resolved action: 'allow' | 'ask' | 'deny', or a
   * {pattern: action} map for pattern-scoped tools (e.g. bash).
   */
  actions: Record<string, string | Record<string, string>>;
  /** Capability names the profile CAN use (anything not flatly denied). */
  granted: string[];
}

/**
 * Resolve what non-MCP capabilities a profile actually has.
 *
 * Mirrors `opencode_agent_writer.writeAgentProfileFile`'s projection order:
 * `corePermissionsJson` entries first, then `imageGenerationEnabled === true`
 * overriding `image_generation` to 'allow' (last-match-wins, exactly as the
 * frontmatter is written). A false flag never writes 'deny' — an explicit
 * corePermissionsJson entry stays authoritative.
 */
export function resolveCoreCapabilitySurface(
  config: Pick<AgentConfig, 'id' | 'corePermissionsJson' | 'imageGenerationEnabled'>,
): CoreCapabilitySurface {
  const actions: Record<string, string | Record<string, string>> = { ...parseCorePermissions(config) };
  if (config.imageGenerationEnabled === true) {
    actions.image_generation = 'allow';
  }
  const granted = Object.entries(actions)
    .filter(([, action]) => action !== 'deny')
    .map(([name]) => name);
  return { actions, granted };
}

/**
 * Map a candidate name onto a known core/provider-executed capability, or null
 * when it is not one. Hyphen/underscore and case drift is normalized, because
 * that is exactly how these names arrive from an LLM diagnosis
 * ('image-generation' for `image_generation`, 'webFetch' for `webfetch`).
 */
export function coreCapabilityName(candidate: string): string | null {
  const normalized = candidate.trim().toLowerCase().replace(/-/g, '_');
  return (CORE_PERMISSION_NAMES as readonly string[]).includes(normalized) ? normalized : null;
}

/**
 * True when the profile already has the given capability, addressed by any
 * spelling {@link coreCapabilityName} accepts. Non-core names are never
 * "granted" here — they belong to the MCP surface, not this one.
 */
export function grantsCoreCapability(
  config: Pick<AgentConfig, 'id' | 'corePermissionsJson' | 'imageGenerationEnabled'>,
  candidate: string,
): boolean {
  const name = coreCapabilityName(candidate);
  if (!name) return false;
  return resolveCoreCapabilitySurface(config).granted.includes(name);
}
