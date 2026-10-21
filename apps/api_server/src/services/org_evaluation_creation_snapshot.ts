/** Existing-state control for proposal kinds that create a new object. */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { env, resolveManagedToolRoot } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import type { OrgEvaluationProposalKind } from '../models/org_evaluation';
import type { FrozenEvaluationProfile, OrgEvaluationTargetSnapshot } from './org_evaluation_fixture';
import { isSafeToolName } from './tool_install_safety';
import { readManagedSkillBytes } from './rhythm_managed_skills';
import { opencodeClient } from './opencode_engine';
import { captureEffectiveEvaluationModel } from './org_evaluation_effective_model';

type Row = Record<string, unknown>;
type Reader = { get(table: string, column: string, value: string): Promise<Row | null>;
  all(table: string): Promise<Row[]> };

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const list = (value: unknown): string[] => {
  try { const parsed = JSON.parse(String(value ?? '[]')) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').sort() : [];
  } catch { return []; }
};
const ownerCanRead = (owner: number | null, rowOwner: unknown) =>
  owner === null ? rowOwner === null : rowOwner === null || Number(rowOwner) === owner;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;

function reader(db?: Database.Database): Reader {
  const tables = new Set(['agent_sessions', 'agent_configs', 'agent_cookbook', 'agent_scheduled_tasks',
    'agent_webhook_endpoints', 'agent_skills']);
  const columns = new Set(['id', 'name', 'title']);
  const query = async (table: string, column?: string, value?: string): Promise<Row[]> => {
    if (!tables.has(table) || column && !columns.has(column)) throw new Error('Unsupported creation snapshot read');
    const sql = `SELECT * FROM ${table}${column ? ` WHERE ${column} = ${db || env.dbClient !== 'postgres' ? '?' : '$1'}` : ''}`;
    if (!db && env.dbClient === 'postgres') return (await getPostgresPool().query(sql, column ? [value] : [])).rows;
    return ((db ?? getDb()).prepare(sql).all(...(column ? [value] : [])) as Row[]);
  };
  return { get: async (table, column, value) => (await query(table, column, value))[0] ?? null,
    all: (table) => query(table) };
}

function frozenProfile(row: Row): FrozenEvaluationProfile {
  if (!row.enabled || row.locked) throw new Error('Verified baseline profile is disabled or locked');
  return {
    id: String(row.id), label: String(row.label), systemPrompt: row.system_prompt as string | null,
    revision: Number(row.revision ?? 0), allowedMcpsJson: row.allowed_mcps_json as string | null,
    allowedSkillsJson: row.allowed_skills_json as string | null,
    corePermissionsJson: row.core_permissions_json as string | null,
    allowedDelegatesJson: row.allowed_delegates_json as string | null,
    isManager: Boolean(row.is_manager), modelProvider: row.model_provider as string | null,
    modelId: row.model_id as string | null,
  };
}

export interface CreationSnapshotInput {
  kind: OrgEvaluationProposalKind;
  targetRef: string;
  expectedRevision: string;
  ownerUserId: number | null;
  change?: Record<string, unknown>;
  /** From citations already verified against owned transcripts, never from changeJson. */
  evidenceSessionIds?: string[];
}

export interface CreationSnapshotDependencies {
  db?: Database.Database;
  /** Trusted engine-side definitions; values are digested and never persisted. */
  mcpDefinitions?: () => Promise<Record<string, unknown>>;
  managedToolRoot?: string;
}

/** Resolve the actual agent from verified transcripts, never from a generated change. */
export async function captureEvidenceBaselineProfileAsync(input: Pick<CreationSnapshotInput,
  'ownerUserId' | 'evidenceSessionIds'>, deps: CreationSnapshotDependencies = {}): Promise<FrozenEvaluationProfile> {
  const evidenceIds = [...new Set(input.evidenceSessionIds ?? [])];
  if (evidenceIds.length < 2 || evidenceIds.length > 20 || evidenceIds.some((id) => !text(id)))
    throw new Error('Creation control requires two verified owned sessions');
  const read = reader(deps.db);
  const sessions = await Promise.all(evidenceIds.map((id) => read.get('agent_sessions', 'id', id)));
  if (sessions.some((session) => !session || !ownerCanRead(input.ownerUserId, session.owner_user_id)
    || session.category === 'self_improvement' || !text(session.profile_id)))
    throw new Error('Creation evidence is outside the owner-scoped baseline');
  const profileId = String(sessions[0]!.profile_id);
  if (sessions.some((session) => session!.profile_id !== profileId)
    || ['org-reviewer', 'org-optimizer'].includes(profileId))
    throw new Error('Creation evidence does not identify one independent baseline profile');
  const profileRow = await read.get('agent_configs', 'id', profileId);
  if (!profileRow) throw new Error('Verified baseline profile no longer exists');
  return frozenProfile(profileRow);
}

/** Returns null for existing-target proposal kinds. Throws on any ambiguity. */
export async function captureCreationTargetAsync(input: CreationSnapshotInput,
  deps: CreationSnapshotDependencies = {}): Promise<OrgEvaluationTargetSnapshot | null> {
  if (!['create-agent', 'create-recipe', 'webhook-wiring', 'tool-install'].includes(input.kind)) return null;
  if (input.expectedRevision !== 'absent') throw new Error('Creation target requires explicit absent revision');
  const profile = await captureEvidenceBaselineProfileAsync(input, deps);
  const profileId = profile.id;
  const evidenceIds = [...new Set(input.evidenceSessionIds ?? [])];
  const read = reader(deps.db);
  const change = input.change ?? {};
  let targetName: string;
  let absenceKind: string;
  const dependencyFingerprints: Record<string, string> = { [`profile:${profile.id}`]: digest(profile) };
  const recipes: OrgEvaluationTargetSnapshot['recipes'] = [];
  const schedules: OrgEvaluationTargetSnapshot['schedules'] = [];
  const skills: OrgEvaluationTargetSnapshot['skills'] = [];
  const managedSkillFiles: OrgEvaluationTargetSnapshot['managedSkillFiles'] = [];
  const profiles = [profile];
  const addSkill = async (name: string) => {
    const row = (await read.all('agent_skills')).find((item) => String(item.title).toLowerCase() === name.toLowerCase());
    if (!row || !['active', 'approved', 'draft'].includes(String(row.status))) throw new Error('Creation skill dependency is unavailable');
    const frozen = { id: String(row.id), title: String(row.title), body: row.body as string | null,
      description: row.description as string | null, whenToUse: row.when_to_use as string | null,
      version: Number(row.version ?? 0), status: String(row.status), confidence: Number(row.confidence ?? 1),
      stepsJson: row.steps_json as string | null ?? null, tagsJson: row.tags_json as string | null ?? null };
    skills.push(frozen);
    dependencyFingerprints[`skill:${frozen.id}`] = digest(frozen);
    const bytes = readManagedSkillBytes(frozen.title);
    if (bytes) managedSkillFiles.push({ name: frozen.title, bytesBase64: bytes.toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex') });
  };
  if (input.kind === 'create-agent') {
    const slug = input.targetRef.startsWith('agent_config:') ? input.targetRef.slice('agent_config:'.length) : '';
    if (!text(slug) || slug !== change.agentSlug || await read.get('agent_configs', 'id', slug))
      throw new Error('Create-agent target is not a verified absent slug');
    targetName = slug; absenceKind = 'agent_config';
    for (const name of list(change.allowedSkillsJson)) await addSkill(name);
  } else if (input.kind === 'create-recipe') {
    const title = change.title;
    if (!text(title) || !input.targetRef.startsWith('recipe:')
      || input.targetRef.slice('recipe:'.length).toLowerCase() !== title.toLowerCase())
      throw new Error('Create-recipe target must name the absent title');
    const collision = (await read.all('agent_cookbook')).some((row) => String(row.title).trim().toLowerCase() === title.trim().toLowerCase());
    if (collision || change.boundConfigId && change.boundConfigId !== profileId)
      throw new Error('Create-recipe title or bound profile changed');
    targetName = title; absenceKind = 'agent_cookbook';
  } else if (input.kind === 'webhook-wiring') {
    const name = change.triggerSource;
    if (!text(name) || ![name, `webhook:${name}`].includes(input.targetRef)
      || (await read.all('agent_webhook_endpoints')).some((row) => String(row.name).trim().toLowerCase() === name.trim().toLowerCase()))
      throw new Error('Webhook target is not a verified absent endpoint');
    if (text(change.targetScheduledTaskId)) {
      const task = await read.get('agent_scheduled_tasks', 'id', change.targetScheduledTaskId);
      if (!task || !ownerCanRead(input.ownerUserId, task.created_by_user_id) || task.agent_config_id !== profileId)
        throw new Error('Webhook task dependency is not owned by the baseline');
      const frozen = { id: String(task.id), name: String(task.name),
        description: task.description as string | null ?? null, prompt: String(task.prompt),
        agentKind: String(task.agent_kind ?? 'opencode'), agentConfigId: task.agent_config_id as string | null,
        modelProvider: task.model_provider as string | null ?? null, modelId: task.model_id as string | null ?? null,
        enabled: task.enabled === undefined || Boolean(task.enabled), scheduleType: String(task.schedule_type),
        scheduledTime: task.scheduled_time as string | null ?? null,
        scheduledDay: task.scheduled_day as number | null ?? null,
        timezone: String(task.timezone ?? 'America/Los_Angeles'),
        cronExpression: task.cron_expression as string | null, runAt: task.run_at as string | null,
        allowedMcpsJson: task.allowed_mcps_json as string | null, allowedSkillsJson: task.allowed_skills_json as string | null };
      schedules.push(frozen); dependencyFingerprints[`task:${frozen.id}`] = digest(frozen);
    } else if (text(change.targetRecipeId)) {
      const recipe = await read.get('agent_cookbook', 'id', change.targetRecipeId);
      if (!recipe || !ownerCanRead(input.ownerUserId, recipe.owner_user_id)
        || recipe.bound_config_id !== profileId) throw new Error('Webhook recipe dependency is not owned by the baseline');
      const frozen = { id: String(recipe.id), title: String(recipe.title), description: recipe.description as string | null,
        stepsJson: String(recipe.steps_json), boundConfigId: recipe.bound_config_id as string | null,
        schemaVersion: recipe.schema_version as number | null, definitionJson: recipe.definition_json as string | null };
      recipes.push(frozen); dependencyFingerprints[`recipe:${frozen.id}`] = digest(frozen);
    } else throw new Error('Webhook creation needs a concrete target dependency');
    targetName = name; absenceKind = 'agent_webhook_endpoints';
  } else {
    const name = change.toolName;
    if (!text(name) || !isSafeToolName(name) || input.targetRef !== `agent_config:${profileId}`
      || change.agentConfigId !== profileId || existsSync(join(deps.managedToolRoot ?? resolveManagedToolRoot(), name)))
      throw new Error('Tool install target or baseline is not verified');
    targetName = name; absenceKind = 'managed-tool';
    dependencyFingerprints[`source:${name}`] = digest({ method: change.installMethod, source: change.packageSource });
  }
  const requestedMcps = input.kind === 'create-agent' ? list(change.allowedMcpsJson) : list(profile.allowedMcpsJson);
  if (requestedMcps.length) {
    const definitions = deps.mcpDefinitions ? await deps.mcpDefinitions() : await opencodeClient.getPersistedMcpConfigs();
    for (const name of requestedMcps) {
      if (!Object.hasOwn(definitions, name)) throw new Error('Creation MCP dependency is unavailable');
      dependencyFingerprints[`mcp:${name}`] = digest(definitions[name]);
    }
  }
  const sorted = Object.fromEntries(Object.entries(dependencyFingerprints).sort(([a], [b]) => a.localeCompare(b)));
  const effectiveModel = captureEffectiveEvaluationModel({
    // The new agent has no model pin. Its actual first run takes the MRU/default
    // branch, even if the cited baseline profile has a different explicit pin.
    profileId: input.kind === 'create-agent' ? null : profile.id,
    profileModelProvider: profile.modelProvider, profileModelId: profile.modelId,
    scheduledModelProvider: schedules[0]?.modelProvider, scheduledModelId: schedules[0]?.modelId,
  }, deps.db);
  return { schemaVersion: 1, effectiveModel, kind: input.kind, targetRef: input.targetRef, targetRevision: 'absent',
    profiles, skills, schedules, recipes, managedSkillFiles,
    creationControl: { targetName, absenceKind, catalogFingerprint: digest({ absenceKind, targetName, sorted }),
      baselineProfileId: profileId, evidenceSessionIds: evidenceIds.sort(), dependencyFingerprints: sorted } };
}
