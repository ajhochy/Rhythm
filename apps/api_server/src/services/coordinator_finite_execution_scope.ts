import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { CoordinatorConversationExecutionScope } from '../contracts/coordinator_conversation_contract';
import type { Project } from '../models/project';
import type { AgentConfig } from '../repositories/agent_configs_repository';
import {
  corePermissionBehaviorSignature,
  parseCorePermissions,
} from './profile_capability_surface';
import {
  resolveProfileMcpScope,
  type McpRoleConfig,
  type ProfileScope,
} from './agent_profile_scope';

export interface FiniteExecutionPermissionRule {
  permission: 'edit' | 'write' | 'bash' | 'external_directory' | '*';
  pattern: string;
  action: 'allow' | 'ask' | 'deny';
}

/** Server-only detail used at the create-session boundary, never serialized to a client. */
export interface ResolvedFiniteExecutionScope {
  preview: CoordinatorConversationExecutionScope;
  targetCwd: string;
  permissionRules: FiniteExecutionPermissionRule[];
  mcpRoleConfig: McpRoleConfig;
  skillAllowlist: string[];
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeWorkspacePattern(value: string): boolean {
  return value.length > 0 && value.length <= 512 &&
    !value.startsWith('/') && !value.startsWith('~') && !value.includes('..') &&
    !value.includes('\\') && !value.includes('://');
}

function normalizedOwnedWorkspaceRoot(value: string): string | null {
  if (!isAbsolute(value) || value === sep || resolve(value) !== value) return null;
  return value;
}

/**
 * The engine resolves file tool inputs to absolute paths before matching its
 * session rules. Profile grants remain relative policy inputs, but the
 * server turns them into canonical patterns beneath the fresh owned root.
 */
function absoluteOwnedWorkspacePattern(workspaceRoot: string, pattern: string): string | null {
  if (!safeWorkspacePattern(pattern)) return null;
  const absolute = resolve(workspaceRoot, pattern);
  const inside = relative(workspaceRoot, absolute);
  if (
    inside.length === 0 || inside === '..' || inside.startsWith(`..${sep}`) ||
    isAbsolute(inside)
  ) return null;
  return absolute;
}

function explicitSkills(value: string | null): string[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((skill) =>
      typeof skill !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(skill),
    )) return null;
    return [...new Set(parsed)].sort();
  } catch {
    return null;
  }
}

/**
 * Project only explicit current write/edit grants into the engine's Ruleset.
 * Catch-all, bash, and external-directory stay denied. Pattern rules are
 * accepted only when they are relative to the server-selected workspace, then
 * normalized to the absolute shape the engine actually matches.
 */
function workspacePermissionRules(
  profile: AgentConfig,
  targetCwd: string,
): FiniteExecutionPermissionRule[] | null {
  const workspaceRoot = normalizedOwnedWorkspaceRoot(targetCwd);
  if (workspaceRoot === null) return null;
  const core = parseCorePermissions(profile);
  const rules: FiniteExecutionPermissionRule[] = [
    { permission: '*', pattern: '*', action: 'deny' },
    { permission: 'external_directory', pattern: '*', action: 'deny' },
    { permission: 'bash', pattern: '*', action: 'deny' },
  ];
  let usable = false;
  for (const permission of ['edit', 'write'] as const) {
    const configured = core[permission];
    if (configured === undefined) continue;
    const entries = typeof configured === 'string'
      ? [['*', configured] as const]
      : Object.entries(configured);
    for (const [pattern, action] of entries) {
      const absolutePattern = absoluteOwnedWorkspacePattern(workspaceRoot, pattern);
      if (!absolutePattern || (action !== 'allow' && action !== 'ask' && action !== 'deny')) return null;
      // The leading catch-all already denies this action. Preserve an explicit
      // deny by omission, and never turn ask into allow.
      if (action === 'deny') continue;
      rules.push({ permission, pattern: absolutePattern, action });
      usable = true;
    }
  }
  return usable ? rules : null;
}

/**
 * Resolve only a current explicit profile scope against a fresh coordinator
 * workspace. Null/unrestricted/malformed MCP or skill state fails closed;
 * this function never invents a tool, path, or capability from caller text.
 */
export function resolveFiniteExecutionScope(input: {
  ownerUserId: number;
  project: Project;
  profile: AgentConfig;
  profileScope: ProfileScope;
  parentCwd: string;
}): ResolvedFiniteExecutionScope | null {
  const { project, profile, profileScope } = input;
  const workspaceGeneration = project.coordinatorWorkspaceGeneration;
  if (
    project.archivedAt !== null || project.coordinatorOwnerUserId !== input.ownerUserId ||
    project.coordinatorSetupProvenance !== 'c2_fresh_owned_workspace_v1' ||
    typeof project.coordinatorSetupKey !== 'string' || project.coordinatorSetupKey.length === 0 ||
    !Number.isSafeInteger(workspaceGeneration) ||
    (workspaceGeneration ?? 0) < 1 ||
    project.coordinatorProfileId !== profile.id || project.cwd !== input.parentCwd ||
    profileScope.mcpRoleConfig === null
  ) return null;
  const mcp = resolveProfileMcpScope(profile.allowedMcpsJson, profile.id, profile.label ?? null);
  if (mcp.shape === 'unrestricted' || mcp.shape === 'invalid') return null;
  const skills = explicitSkills(profile.allowedSkillsJson);
  if (skills === null) return null;
  const permissionRules = workspacePermissionRules(profile, project.cwd);
  if (!permissionRules) return null;
  if (workspaceGeneration === null || workspaceGeneration === undefined) return null;
  const preview: CoordinatorConversationExecutionScope = {
    schemaVersion: 1,
    kind: 'scoped_workspace_execution',
    projectId: project.id,
    workspaceGeneration,
    profileId: profile.id,
    profileRevision: profile.revision ?? 1,
    targetFingerprint: hash({ projectId: project.id, cwd: project.cwd, generation: workspaceGeneration }),
    scopeSignature: hash({
      target: { projectId: project.id, generation: workspaceGeneration },
      profile: {
        id: profile.id,
        revision: profile.revision ?? 1,
        corePermissions: corePermissionBehaviorSignature(parseCorePermissions(profile)),
        allowedMcpsJson: profile.allowedMcpsJson,
        allowedSkillsJson: profile.allowedSkillsJson,
      },
      permissionRules,
      mcpRole: profileScope.mcpRoleConfig,
      skills,
    }),
  };
  return {
    preview,
    targetCwd: project.cwd,
    permissionRules,
    mcpRoleConfig: profileScope.mcpRoleConfig,
    skillAllowlist: skills,
  };
}
