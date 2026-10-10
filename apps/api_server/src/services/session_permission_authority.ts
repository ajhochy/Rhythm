import { AppError } from '../errors/app_error';
import { PERMISSION_MODES, type AgentSession, type PermissionMode } from '../models/agent_session';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentConfigsRepository, agentConfigExecutionBlockReason } from '../repositories/agent_configs_repository';
import { computeEffectivePermissionMap, permissionPatternMatches, type EffectivePermissionMap } from './opencode_agent_writer';
import { opencodeSessionMap } from './opencode_engine';
import { getDb } from '../database/db';
import { classifyCommands, extractBashCommands } from '../security/command_approval';
import { resolveApprovalsMode } from '../config/env';
import { isToolAllowed } from './mcp_dispatch_guard';

// Same builtin/scope exclusions formerly local to the bridge; policy is shared with manual replies.
export const NON_TOOL_PERMISSION_SCOPES = new Set(['doom_loop','external_directory','plan_enter','plan_exit','question','repo_clone','repo_overview']);
export const OPENCODE_NATIVE_TOOLS = new Set(['invalid','bash','read','glob','grep','edit','write','task','webfetch','todowrite','websearch',
  'repo_clone','repo_overview','skill','apply_patch','question','lsp','plan_exit','image_generation']);

// ponytail: per-session transition fence, no persistent grant or global profile mutation.
const transitions = new Map<string, symbol>();
export const PARENT_PERMISSION_CANCELLED = 'Cancelled: permission authority requires a new parent turn or resume.';
export function beginSessionPermissionTransition(sessionId: string): symbol {
  if (transitions.has(sessionId)) throw AppError.forbidden('permission authority transition already pending');
  const token = Symbol(sessionId); transitions.set(sessionId, token); return token;
}
export function endSessionPermissionTransition(sessionId: string, token: symbol): void {
  if (transitions.get(sessionId) === token) transitions.delete(sessionId);
}

export function descendantPermissionSessionIds(sessionId: string): string[] {
  const ids = new Set<string>([sessionId]);
  for (const id of ids) {
    const children = getDb().prepare('SELECT id FROM agent_sessions WHERE parent_session_id = ?').all(id) as Array<{id:string}>;
    for (const child of children) ids.add(child.id);
    if (ids.size > 1000) throw AppError.forbidden('permission authority: descendant fence exceeds bounded scope');
  }
  ids.delete(sessionId); return [...ids];
}

export interface SessionPermissionAuthority {
  session: AgentSession;
  chain: AgentSession[];
  mode: PermissionMode;
  inheritedMode: PermissionMode;
  policies: EffectivePermissionMap[];
  fingerprint: string;
}

/** Current durable identity only. No grant, profile mutation or remembered approval. */
export function resolveSessionPermissionAuthority(
  sessionId: string,
  expected: { ownerUserId?: number | null; sdkSessionId?: string; directory?: string; transitionToken?: symbol; allowCancelledSelf?: boolean } = {},
): SessionPermissionAuthority {
  const repo = new AgentSessionsRepository();
  const session = repo.findById(sessionId);
  if (!session) throw AppError.forbidden('permission authority: session binding unavailable');
  if ((expected.ownerUserId !== undefined && expected.ownerUserId !== session.ownerUserId) ||
      (expected.sdkSessionId !== undefined && expected.sdkSessionId !== (session.sdkSessionId ?? (session.ownerUserId === null ? opencodeSessionMap.get(session.id) : undefined))) ||
      (expected.directory !== undefined && expected.directory !== session.cwd)) {
    throw AppError.forbidden('permission authority: identity binding mismatch');
  }
  const chain: AgentSession[] = [];
  let current: AgentSession | null = session;
  while (current) {
    if (current.statusMessage === PARENT_PERMISSION_CANCELLED && !(expected.allowCancelledSelf && current.id === session.id)) {
      throw AppError.forbidden('permission authority: parent cancellation requires resume');
    }
    if ((transitions.has(current.id) && transitions.get(current.id) !== expected.transitionToken) ||
        (current.sdkSessionId !== null && opencodeSessionMap.has(current.id) && opencodeSessionMap.get(current.id) !== current.sdkSessionId)) {
      throw AppError.forbidden('permission authority: transition pending or SDK mapping changed');
    }
    if (chain.some(row => row.id === current!.id) || chain.length >= 32 ||
        !PERMISSION_MODES.includes(current.permissionMode) || current.archivedAt || current.status === 'closed') {
      throw AppError.forbidden('permission authority: parent binding revoked or invalid');
    }
    if (current.ownerUserId !== session.ownerUserId || current.projectId !== session.projectId) {
      throw AppError.forbidden('permission authority: parent owner/project binding mismatch');
    }
    if (current.id !== session.id && ['error','resumable'].includes(current.status)) {
      throw AppError.forbidden('permission authority: parent is stopped');
    }
    chain.push(current);
    if (!current.parentSessionId) break;
    current = repo.findById(current.parentSessionId);
    if (!current || !current.sdkSessionId) throw AppError.forbidden('permission authority: parent binding unavailable');
  }
  const configs = new AgentConfigsRepository();
  const roster = configs.list();
  const profiles = chain.map(row => {
    // profileId wins; legacy mcpRole is a compatibility identity, never a same-name foreign engine argument.
    const namedChild = /\(@([^\s)]+) subagent\)\s*$/.exec(row.name)?.[1];
    const id = row.profileId ?? row.mcpRole ?? (namedChild === row.agentKind ? namedChild : undefined);
    const config = id ? configs.getById(id) : null;
    if (row.profileId && !config) throw AppError.forbidden('permission authority: profile binding unavailable');
    if (config && agentConfigExecutionBlockReason(config)) throw AppError.forbidden('permission authority: profile is unavailable');
    return config;
  });
  const root = chain[chain.length - 1];
  const mode = chain.some(row => row.permissionMode === 'plan') ? 'plan'
    : root.ownerUserId === null || root.permissionMode === 'bypassPermissions' ? session.permissionMode : root.permissionMode;
  const inheritedMode = chain.slice(1).some(row => row.permissionMode === 'plan') ? 'plan'
    : session.parentSessionId && root.ownerUserId !== null ? root.permissionMode : mode;
  const policies = profiles.filter((p): p is NonNullable<typeof p> => p !== null).map(p => computeEffectivePermissionMap(p, roster));
  const fingerprint = JSON.stringify({
    chain: chain.map(row => [row.id,row.parentSessionId,row.ownerUserId,row.projectId,row.sdkSessionId,row.cwd,
      row.profileId,row.opencodeAgentId,row.mcpRole,row.permissionMode,row.mcpAllowedToolsJson,row.archivedAt,['closed','error','resumable'].includes(row.status),row.statusMessage === PARENT_PERMISSION_CANCELLED]),
    profiles, policies,
  });
  return { session, chain, mode, inheritedMode, policies, fingerprint };
}

export function assertSessionPermissionAuthorityCurrent(authority: SessionPermissionAuthority, transitionToken?: symbol): void {
  if (resolveSessionPermissionAuthority(authority.session.id, { transitionToken,
    allowCancelledSelf: authority.session.statusMessage === PARENT_PERMISSION_CANCELLED }).fingerprint !== authority.fingerprint) {
    throw AppError.forbidden('permission authority scope changed during setup');
  }
}

function policyAction(policy: EffectivePermissionMap, permission: string, pattern: string): string {
  let action = 'ask';
  for (const [name, value] of Object.entries(policy)) {
    if (!permissionPatternMatches(permission, name)) continue;
    for (const [match, effect] of Object.entries(typeof value === 'string' ? { '*': value } : value)) {
      if (permissionPatternMatches(pattern, match)) action = effect;
    }
  }
  return action;
}

/** Coordinator R2 inserts a per-worker scoped grant AFTER this result, never overrides deny/PLAN. */
export function resolveSessionPermissionOperation(
  authority: SessionPermissionAuthority, permission: string, patterns: readonly string[], args: Record<string, unknown> = {},
): 'deny' | 'ask' | 'allow' {
  if (authority.mode === 'plan') return 'deny';
  if (authority.policies.some(policy => (patterns.length ? patterns : ['*']).some(pattern => policyAction(policy, permission, pattern) === 'deny'))) return 'deny';
  if (permission.toLowerCase() === 'bash') {
    const commands = extractBashCommands(args, [...patterns]);
    if (commands.length && classifyCommands(commands, resolveApprovalsMode())?.decision === 'deny') return 'deny';
  }
  if (!NON_TOOL_PERMISSION_SCOPES.has(permission) && !OPENCODE_NATIVE_TOOLS.has(permission) &&
      authority.chain.some(row => row.mcpRole !== null && !isToolAllowed(permission, row.mcpAllowedToolsJson))) return 'deny';
  return authority.mode === 'bypassPermissions' ||
    (authority.mode === 'acceptEdits' && ['edit','write','patch'].includes(permission.toLowerCase())) ? 'allow' : 'ask';
}

/** Native asks, not blanket denies: bridge intersects each current profile with last-match exceptions intact. */
export function sessionAuthorityAskRules(authority: SessionPermissionAuthority): Array<{ permission: string; pattern: string; action: 'ask' }> {
  if (authority.mode === 'plan') return [];
  const permissions = new Set<string>();
  for (const policy of authority.policies) for (const [permission,value] of Object.entries(policy)) {
    if (typeof value === 'string' ? value === 'deny' : Object.values(value).includes('deny')) permissions.add(permission);
  }
  return [...permissions].map(permission => ({ permission, pattern:'*', action:'ask' }));
}
