import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';

import type { AgentConfig } from '../repositories/agent_configs_repository';
import { agentConfigExecutionBlockReason } from '../repositories/agent_configs_repository';
import { resolveMemoryVaultPath, env } from '../config/env';
import { scanContextContent } from '../security/context_scanner';
import { isProjectablePermissionValue } from '../services/profile_capability_surface';
import { resolveProfileMcpScope } from '../services/agent_profile_scope';
import { computeEffectivePermissionMap } from '../services/opencode_agent_writer';
import {
  CANONICAL_FIELDS,
  RHYTHM_TOOL_MAP,
  SHARED_AGENT_SCHEMA,
  type CanonicalAgentConfigV1,
  type CanonicalFieldName,
  type FieldApplicability,
  type ProjectionEffect,
  type ProjectionRule,
  type RuntimeProjectionSummaryV1,
  type SharedAgentReason,
  type SharedAgentReasonCode,
  type SharedAgentSnapshotV2,
  type SharedAgentV1,
} from './contract';

const execFileAsync = promisify(execFile);
const PROVIDERS: Record<string, string> = {
  anthropic: 'anthropic', openrouter: 'openrouter', openai: 'openai-api', google: 'gemini',
};

export interface HermesRuntimeState {
  connected?: boolean;
  reported?: boolean;
  owned?: boolean;
  bridgeAvailable?: boolean;
  executorFresh?: boolean;
  providers?: Array<{ id: string; ready: boolean }>;
  reasoningEfforts?: string[];
  terminalBackend?: 'local' | 'container' | 'remote' | 'unknown';
}

export interface ProjectionContext {
  localUserId: number;
  runtime: HermesRuntimeState;
  cwd: string | null;
  sessionRevision?: number;
}

export interface IssueProjectionOptions extends ProjectionContext {
  launchKind: 'interactive' | 'delegated';
  roster: AgentConfig[];
  expectedRevision?: number;
  leaseToken?: string;
  protected?: string[];
  reference?: string;
}

export class ProjectionError extends Error {
  constructor(
    public readonly code: string,
    message = code,
    public readonly details: Record<string, unknown> = {},
  ) { super(message); }
}

function reason(code: SharedAgentReasonCode, field?: CanonicalFieldName): SharedAgentReason {
  return { code, ...(field ? { field } : {}), message: code.replaceAll('_', ' ').slice(0, 240) };
}

function parseJsonStrict(config: AgentConfig, field: 'corePermissionsJson' | 'allowedMcpsJson' | 'allowedSkillsJson' | 'allowedDelegatesJson', reasons: SharedAgentReason[]): unknown {
  const raw = config[field];
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { reasons.push(reason('permission_shape_unsupported', field)); return undefined; }
}

function validateStoredShapes(config: AgentConfig, reasons: SharedAgentReason[]): void {
  const core = parseJsonStrict(config, 'corePermissionsJson', reasons);
  if (core !== null && core !== undefined) {
    if (!core || typeof core !== 'object' || Array.isArray(core) || Object.entries(core).some(([key, value]) => !key.trim() || !isProjectablePermissionValue(value))) {
      reasons.push(reason('permission_shape_unsupported', 'corePermissionsJson'));
    } else {
      const permissions = core as Record<string, string | Record<string, string>>;
      const universalOnly = new Set([
        'glob', 'grep', 'list', 'webfetch', 'websearch', 'todowrite', 'question',
      ]);
      if ([...universalOnly].some((name) => {
        const value = permissions[name];
        return typeof value === 'object' && Object.keys(value).some((pattern) => pattern !== '*');
      })) {
        reasons.push(reason('permission_shape_unsupported', 'corePermissionsJson'));
      }
      const external = permissions.external_directory;
      if (typeof external === 'object' && Object.keys(external).some((pattern) => pattern !== '*')) {
        reasons.push(reason('external_directory_pattern_unsupported', 'corePermissionsJson'));
      }
    }
  }
  for (const field of ['allowedMcpsJson', 'allowedSkillsJson', 'allowedDelegatesJson'] as const) {
    parseJsonStrict(config, field, reasons);
  }
}

function canonical(config: AgentConfig): CanonicalAgentConfigV1 {
  return Object.fromEntries(CANONICAL_FIELDS.map((field) => [field, config[field]])) as CanonicalAgentConfigV1;
}

function fields(config: AgentConfig): Record<CanonicalFieldName, FieldApplicability> {
  const presentation = new Set<CanonicalFieldName>(['label','icon','presetId','sortOrder','createdAt','updatedAt','disabledReason','lockedAt','lockedBy','schedulable','schedulableOverride','modelTierHint']);
  const restrictive = new Set<CanonicalFieldName>(['allowedSkillsJson','allowedMcpsJson','imageGenerationEnabled','autoApproveActions']);
  return Object.fromEntries(CANONICAL_FIELDS.map((field) => [
    field,
    field === 'defaultAnthropicAccountId'
      ? (config.defaultAnthropicAccountId ? 'blocked' : 'not-set')
      : restrictive.has(field)
        ? 'restrictive'
        : presentation.has(field)
          ? 'presentation'
          : 'enforced',
  ])) as Record<CanonicalFieldName, FieldApplicability>;
}

function blockingReasons(config: AgentConfig, runtime: HermesRuntimeState): SharedAgentReason[] {
  const reasons: SharedAgentReason[] = [];
  validateStoredShapes(config, reasons);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.id)) reasons.push(reason('agent_id_unsupported', 'id'));
  if (config.systemPrompt && scanContextContent(config.systemPrompt, `agent profile ${config.id}`).blocked) reasons.push(reason('instructions_blocked_by_scanner', 'systemPrompt'));
  if (!config.modelProvider || !config.modelId) reasons.push(reason('model_unpinned', !config.modelProvider ? 'modelProvider' : 'modelId'));
  else if (!PROVIDERS[config.modelProvider]) reasons.push(reason('model_provider_unmapped', 'modelProvider'));
  if (config.defaultAnthropicAccountId) reasons.push(reason('account_binding_unmapped', 'defaultAnthropicAccountId'));
  if (config.ocAgent && config.ocAgent !== 'build' && config.ocAgent !== 'plan' && config.ocAgent !== config.id) reasons.push(reason('oc_agent_unsupported', 'ocAgent'));
  if (runtime.terminalBackend && runtime.terminalBackend !== 'local') reasons.push(reason('terminal_backend_unsupported'));
  if (config.reasoningEffort && runtime.reasoningEfforts?.length && !runtime.reasoningEfforts.includes(config.reasoningEffort)) reasons.push(reason('reasoning_invalid', 'reasoningEffort'));
  return [...new Map(reasons.map((entry) => [`${entry.code}:${entry.field ?? ''}`, entry])).values()];
}

function informationalReasons(config: AgentConfig): SharedAgentReason[] {
  const reasons: SharedAgentReason[] = [];
  if (config.allowedSkillsJson === null || config.allowedSkillsJson !== '[]') {
    reasons.push(reason('skills_not_applied', 'allowedSkillsJson'));
  }
  if (config.schedulable !== undefined || config.schedulableOverride !== undefined) {
    reasons.push(reason('schedulable_not_applied', 'schedulable'));
  }
  if (config.modelTierHint) reasons.push(reason('model_tier_hint_ignored', 'modelTierHint'));
  if (config.imageGenerationEnabled) reasons.push(reason('image_generation_not_applied', 'imageGenerationEnabled'));
  if (config.autoApproveActions) reasons.push(reason('auto_approve_not_applied', 'autoApproveActions'));
  return reasons;
}

function unavailable(config: AgentConfig, runtime: HermesRuntimeState): SharedAgentReason[] {
  if (config.locked) return [reason('agent_locked', 'locked')];
  if (!config.enabled) return [reason('agent_disabled', 'enabled')];
  if (!config.isAgent) return [reason('agent_not_runnable', 'isAgent')];
  if (runtime.owned === false) return [reason('runtime_unowned')];
  if (runtime.bridgeAvailable === false) return [reason('bridge_unavailable')];
  if (!runtime.connected) return [reason('runtime_not_connected')];
  if (!runtime.reported) return [reason('runtime_not_reported')];
  const mapped = config.modelProvider ? PROVIDERS[config.modelProvider] : null;
  if (mapped && runtime.providers && !runtime.providers.some((provider) => provider.id === mapped && provider.ready)) return [reason('model_provider_unavailable', 'modelProvider')];
  return [];
}

export async function buildSharedAgent(config: AgentConfig, context: ProjectionContext): Promise<SharedAgentV1> {
  const hermesUnavailable = unavailable(config, context.runtime);
  const hermesBlocking = blockingReasons(config, context.runtime);
  const hermesInfo = informationalReasons(config);
  if (context.sessionRevision !== undefined && context.sessionRevision < (config.revision ?? 0)) hermesInfo.push(reason('revision_newer_than_session'));
  const readiness = hermesUnavailable.length ? 'unavailable' : hermesBlocking.length ? 'unsupported' : hermesInfo.some((entry) => entry.code === 'revision_newer_than_session') ? 'pending-new-session' : 'supported';
  const executorFresh = context.runtime.executorFresh !== false;
  const hermesReasons = [...hermesUnavailable, ...hermesBlocking, ...hermesInfo];
  if (readiness === 'supported' && !executorFresh) hermesReasons.push(reason('executor_not_ready'));
  const runFields = fields(config);
  const hermes: RuntimeProjectionSummaryV1 = {
    runtime: 'hermes', readiness, reasons: hermesReasons,
    launchKinds: { interactive: readiness === 'supported' && config.sessionSelectable, delegated: readiness === 'supported' && config.isAgent && executorFresh },
    fields: runFields,
  };
  const blockReason = agentConfigExecutionBlockReason(config);
  const openReadiness = blockReason || !config.isAgent ? 'unavailable' : 'supported';
  return {
    schema: SHARED_AGENT_SCHEMA, id: config.id, revision: config.revision ?? 0,
    canonical: canonical(config),
    runtimes: {
      opencode: { runtime: 'opencode', readiness: openReadiness, reasons: [], launchKinds: { interactive: openReadiness === 'supported' && config.sessionSelectable, delegated: openReadiness === 'supported' && config.isAgent }, fields: runFields },
      hermes,
    },
  };
}

export async function resolveOpencodeRoots(cwd: string): Promise<{ directory: string; worktree: string }> {
  const directory = await realpath(cwd);
  let cursor = directory;
  let sandbox: string | null = null;
  while (true) {
    try { await realpath(resolve(cursor, '.git')); sandbox = cursor; break; } catch { /* continue */ }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (!sandbox) return { directory, worktree: '/' };
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], { cwd: sandbox, timeout: 2_000 });
    const common = await realpath(resolve(sandbox, stdout.trim()));
    let bare = false;
    try { bare = (await execFileAsync('git', ['rev-parse', '--is-bare-repository'], { cwd: sandbox, timeout: 2_000 })).stdout.trim() === 'true'; } catch { /* fallback */ }
    return { directory, worktree: common === sandbox ? sandbox : bare ? common : dirname(common) };
  } catch { return { directory, worktree: sandbox }; }
}

function wildcard(input: string, pattern: string): boolean {
  let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  if (escaped.endsWith(' .*')) escaped = `${escaped.slice(0, -3)}( .*)?`;
  return new RegExp(`^${escaped}$`, 's').test(input);
}

interface FlatPermissionRule {
  permission: string;
  pattern: string;
  effect: ProjectionEffect;
}

function expandPermissionPattern(pattern: string): string {
  if (pattern === '~') return homedir();
  if (pattern.startsWith('~/')) return resolve(homedir(), pattern.slice(2));
  if (pattern === '$HOME') return homedir();
  if (pattern.startsWith('$HOME/')) return resolve(homedir(), pattern.slice(6));
  return pattern;
}

function flattenPermissions(
  permissions: Record<string, string | Record<string, string>>,
): FlatPermissionRule[] {
  return Object.entries(permissions).flatMap(([permission, value]) => (
    typeof value === 'string'
      ? [{ permission, pattern: '*', effect: value as ProjectionEffect }]
      : Object.entries(value).map(([pattern, effect]) => ({
        permission,
        pattern: expandPermissionPattern(pattern),
        effect: effect as ProjectionEffect,
      }))
  ));
}

function effectAt(flat: FlatPermissionRule[], name: string, input: string): ProjectionEffect {
  let result: ProjectionEffect = 'ask';
  for (const rule of flat) {
    if (wildcard(name, rule.permission) && wildcard(input, rule.pattern)) result = rule.effect;
  }
  return result;
}

function rulesFor(name: string, flat: FlatPermissionRule[], tool: string, transformPath: boolean, reasons: SharedAgentReason[]): ProjectionRule[] {
  const entries = flat.filter((entry) => wildcard(name, entry.permission));
  const rules: ProjectionRule[] = [{ tool, argument: tool === 'terminal' ? 'command' : 'path', pattern: '*', effect: 'ask' }];
  for (const entry of entries) {
    if (transformPath && isAbsolute(entry.pattern)) {
      reasons.push(reason('path_pattern_inert', 'corePermissionsJson'));
      continue;
    }
    rules.push({ tool, argument: tool === 'terminal' ? 'command' : 'path', pattern: entry.pattern, effect: entry.effect });
  }
  return rules;
}

const STRICT = { allow: 0, ask: 1, deny: 2 } as const;
function strictest(...effects: ProjectionEffect[]): ProjectionEffect { return effects.sort((a, b) => STRICT[b] - STRICT[a])[0]; }

export function effectiveDelegationPermission(
  config: AgentConfig,
  roster: ReadonlyArray<Pick<AgentConfig, 'id'>>,
  targetId: string,
): ProjectionEffect {
  const flat = flattenPermissions(computeEffectivePermissionMap(config, roster));
  return strictest(
    effectAt(flat, 'task', targetId),
    effectAt(flat, 'rhythm_delegate_async', targetId),
  );
}

export async function issueProjection(config: AgentConfig, options: IssueProjectionOptions): Promise<{ snapshot: SharedAgentSnapshotV2; reasons: SharedAgentReason[] }> {
  if (options.launchKind === 'interactive' && !config.sessionSelectable) throw new ProjectionError('launch_kind_not_allowed');
  if (options.launchKind === 'delegated' && !options.leaseToken) throw new ProjectionError('lease_invalid');
  const agent = await buildSharedAgent(config, options);
  if (agent.runtimes.hermes.readiness === 'unsupported' || agent.runtimes.hermes.readiness === 'unavailable') {
    throw new ProjectionError('projection_unsupported', 'projection_unsupported', {
      reasons: agent.runtimes.hermes.reasons,
    });
  }
  if (options.expectedRevision !== undefined && options.expectedRevision !== (config.revision ?? 0)) {
    throw new ProjectionError('revision_conflict', 'revision_conflict', { currentRevision: config.revision ?? 0 });
  }
  const reasons = [...agent.runtimes.hermes.reasons];
  const permissions = computeEffectivePermissionMap(config, options.roster);
  const flat = flattenPermissions(permissions);
  const allowed = new Set<string>();
  const rules: ProjectionRule[] = [];
  const toolEffects: Record<string, 'ask'> = {};
  const consultedPermissionNames = [
    'read', 'edit', 'glob', 'grep', 'list', 'bash', 'external_directory',
    'webfetch', 'websearch', 'todowrite', 'question', 'task',
    'rhythm_delegate_async', 'skill',
    ...Object.keys(RHYTHM_TOOL_MAP).map((tool) => `rhythm_${tool}`),
  ];
  for (const name of Object.keys(permissions)) {
    if (name === 'write' || name === 'process') continue;
    if (!consultedPermissionNames.some((consulted) => wildcard(consulted, name))) {
      reasons.push(reason('permission_key_not_applied', 'corePermissionsJson'));
    }
  }
  const addRules = (name: string, tools: string[], path = false) => {
    for (const tool of tools) {
      const candidates = rulesFor(name, flat, tool, path, reasons);
      const finalStar = candidates
        .map((entry, index) => entry.pattern === '*' ? index : -1)
        .filter((index) => index >= 0)
        .at(-1) ?? 0;
      if (!candidates.slice(finalStar).every((entry) => entry.effect === 'deny')) {
        allowed.add(tool);
        rules.push(...candidates);
      }
    }
  };
  addRules('read', ['read_file'], true);
  addRules('edit', ['write_file','patch'], true);
  addRules('bash', ['terminal']);
  if (permissions.write !== undefined) reasons.push(reason('write_permission_inert', 'corePermissionsJson'));
  if (permissions.process !== undefined) reasons.push(reason('process_tool_not_applied', 'corePermissionsJson'));
  const scalar: Array<[string,string]> = [['webfetch','web_extract'],['websearch','web_search'],['todowrite','todo'],['question','clarify']];
  for (const [name, tool] of scalar) {
    const effect = effectAt(flat, name, '*');
    if (effect !== 'deny') { allowed.add(tool); if (effect === 'ask') toolEffects[tool] = 'ask'; }
  }
  const searchEffect = strictest(effectAt(flat, 'glob', '*'), effectAt(flat, 'grep', '*'), effectAt(flat, 'list', '*'));
  if (searchEffect !== 'deny') { allowed.add('search_files'); if (searchEffect === 'ask') toolEffects.search_files = 'ask'; }
  if (options.launchKind === 'interactive' && config.isManager && config.sessionSelectable) {
    const roster = new Map(options.roster.map((entry) => [entry.id, entry]));
    const allowedIds = (() => { try { const value = JSON.parse(config.allowedDelegatesJson ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; } })();
    const targets = allowedIds.filter((id) => (
      id !== config.id
      && roster.has(id)
      && strictest(effectAt(flat, 'task', id), effectAt(flat, 'rhythm_delegate_async', id)) !== 'deny'
    ));
    if (targets.length) {
      ['rhythm_delegate','rhythm_delegation_status','rhythm_delegation_result','rhythm_delegation_cancel'].forEach((tool) => allowed.add(tool));
      rules.push({ tool: 'rhythm_delegate', argument: 'targetAgentId', pattern: '*', effect: 'deny' });
      for (const id of targets) rules.push({ tool: 'rhythm_delegate', argument: 'targetAgentId', pattern: id, effect: strictest(effectAt(flat, 'task', id), effectAt(flat, 'rhythm_delegate_async', id)) });
    }
  }
  const mcp = resolveProfileMcpScope(config.allowedMcpsJson ?? null, config.id, config.label);
  if (mcp.shape === 'unrestricted') reasons.push(reason('mcp_inherit_restricted', 'allowedMcpsJson'));
  else for (const [server, tools] of Object.entries(mcp.toolsByServer)) {
    if (server !== 'rhythm') { reasons.push(reason('mcp_unmapped', 'allowedMcpsJson')); continue; }
    const selected = tools.length ? tools : Object.keys(RHYTHM_TOOL_MAP);
    for (const source of selected) {
      const mapped = RHYTHM_TOOL_MAP[source as keyof typeof RHYTHM_TOOL_MAP];
      if (!mapped) { reasons.push(reason('mcp_unmapped', 'allowedMcpsJson')); continue; }
      const permissionKey = `${server}_${source}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const effect = effectAt(flat, permissionKey, '*');
      if (effect !== 'deny') { allowed.add(mapped); if (effect === 'ask') toolEffects[mapped] = 'ask'; }
    }
  }
  if (config.allowedSkillsJson !== '[]') reasons.push(reason('skills_not_applied', 'allowedSkillsJson'));
  if (config.ocAgent === 'plan') {
    allowed.delete('write_file'); allowed.delete('patch');
    for (const rule of rules) if (rule.tool === 'terminal') rule.effect = strictest(rule.effect, 'ask');
  }
  const roots = options.cwd ? await resolveOpencodeRoots(options.cwd) : { directory: '/', worktree: '/' };
  const protectedPaths: string[] = options.protected ?? await Promise.all(
    [dirname(env.dbPath), resolveMemoryVaultPath()].map(async (value) => {
      try { return await realpath(value); } catch { return null; }
    }),
  ).then((values) => values.filter((value): value is string => value !== null));
  if (options.cwd && protectedPaths.some((path) => roots.directory === path || roots.directory.startsWith(`${path}/`))) throw new ProjectionError('cwd_invalid');
  const external = effectAt(flat, 'external_directory', '*');
  if (permissions.external_directory && typeof permissions.external_directory !== 'string' && Object.keys(permissions.external_directory).some((pattern) => pattern !== '*')) {
    throw new ProjectionError('projection_unsupported', 'projection_unsupported', {
      reasons: [reason('external_directory_pattern_unsupported', 'corePermissionsJson')],
    });
  }
  const delegationTargets = rules
    .filter((entry) => entry.tool === 'rhythm_delegate' && entry.pattern !== '*')
    .map((entry) => entry.pattern);
  const instructions = config.systemPrompt?.trim() || null;
  const projectedInstructions = instructions && options.launchKind === 'interactive' && delegationTargets.length
    ? `${instructions}\n\n## Delegation\nUse the rhythm_delegate tool. Allowed targets: ${delegationTargets.join(', ')}.`
    : instructions;
  const modelProvider = PROVIDERS[config.modelProvider!];
  const snapshot: SharedAgentSnapshotV2 = {
    version: 2,
    source: { agent_id: config.id, revision: config.revision ?? 0, reference: options.reference ?? randomUUID() },
    instructions: projectedInstructions,
    model: { provider: modelProvider, model: config.modelId!, reasoning: config.reasoningEffort ?? null },
    allowed_tools: [...allowed].sort(), tool_effects: toolEffects,
    paths: { root: roots.worktree, boundary: options.cwd ? [roots.directory, ...(roots.worktree !== '/' && roots.worktree !== roots.directory ? [roots.worktree] : [])] : [], external, protected: protectedPaths },
    rules,
    taint_gate: { sources: ['rhythm_delegation_result','rhythm_memory_search','web_extract','web_search'].filter((tool) => allowed.has(tool)), gated: allowed.has('rhythm_delegate') ? ['rhythm_delegate'] : [] },
    launch: { kind: options.launchKind, cwd: options.cwd ? roots.directory : null },
  };
  return { snapshot, reasons: [...new Map(reasons.map((entry) => [`${entry.code}:${entry.field ?? ''}`, entry])).values()] };
}

export function catalogScope(localUserId: number): string {
  return createHash('sha256').update(`rhythm-shared-agents|${localUserId}`).digest('hex').slice(0, 16);
}
