/** A fresh minimal SQLite fixture built from explicitly frozen target state. */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import type { OrgEvaluationProposalKind } from '../models/org_evaluation';
import type { AgentSkill } from '../models/agent_skill';
import { AgentConfigsRepository, type AgentConfig } from '../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';
import { scanContextContent } from '../security/context_scanner';
import { readManagedSkillBytes, slugForSkillName } from './rhythm_managed_skills';
import { freezeEvaluationManagedSkillDependency } from './org_evaluation_managed_skill_dependency';
import { captureCreationTargetAsync, captureEvidenceBaselineProfileAsync } from './org_evaluation_creation_snapshot';
import { captureEffectiveEvaluationModel, type FrozenEvaluationModel } from './org_evaluation_effective_model';
import { captureOrgPublicationStateAsync, type FrozenOrgPublicationState } from './org_evaluation_publication_state';
import { captureExternalSkillSourceAsync, type FrozenExternalSkillSource } from './org_evaluation_external_source';

export interface FrozenEvaluationProfile {
  id: string;
  label: string;
  systemPrompt: string | null;
  revision: number;
  allowedMcpsJson: string | null;
  allowedSkillsJson: string | null;
  corePermissionsJson: string | null;
  allowedDelegatesJson: string | null;
  isManager: boolean;
  modelProvider: string | null;
  modelId: string | null;
}

export interface FrozenEvaluationSkill {
  id: string;
  title: string;
  body: string | null;
  description: string | null;
  whenToUse: string | null;
  version: number;
  status?: string;
  confidence?: number;
  stepsJson?: string | null;
  tagsJson?: string | null;
}

export interface FrozenEvaluationSchedule {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  agentKind: string;
  agentConfigId: string | null;
  modelProvider: string | null;
  modelId: string | null;
  enabled: boolean;
  scheduleType: string;
  scheduledTime: string | null;
  scheduledDay: number | null;
  timezone: string;
  cronExpression: string | null;
  runAt: string | null;
  allowedMcpsJson: string | null;
  allowedSkillsJson: string | null;
}

export interface FrozenEvaluationRecipe {
  id: string;
  title: string;
  description: string | null;
  stepsJson: string;
  boundConfigId: string | null;
  schemaVersion: number | null;
  definitionJson: string | null;
}

export interface OrgEvaluationTargetSnapshot {
  schemaVersion: 1;
  /** Exact production model cascade, including a model-only MRU fallback. */
  effectiveModel: FrozenEvaluationModel;
  kind: OrgEvaluationProposalKind;
  targetRef: string;
  targetRevision: string;
  profiles: FrozenEvaluationProfile[];
  skills: FrozenEvaluationSkill[];
  schedules: FrozenEvaluationSchedule[];
  recipes: FrozenEvaluationRecipe[];
  creationControl?: {
    targetName: string;
    absenceKind: string;
    catalogFingerprint: string;
    baselineProfileId: string;
    evidenceSessionIds: string[];
    dependencyFingerprints: Record<string, string>;
  };
  managedSkillFiles: { name: string; bytesBase64: string; sha256: string }[];
  /** Allowed skills with no managed SKILL.md at capture time. */
  managedSkillAbsences?: string[];
  /** Public org-library bytes at diagnosis time, including verified absence. */
  publicationOriginal?: FrozenOrgPublicationState;
  /** Exact commit-pinned external skill bytes observed by the parent API. */
  externalSkillSource?: FrozenExternalSkillSource;
}

export interface PreparedOrgEvaluationFixture {
  fixtureRoot: string;
  fixtureDb: string;
  fixtureConfig: string;
  sourceHash: string;
}

function namesFromJson(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, 32)
      : [];
  } catch { return []; }
}

function freezeProfile(config: AgentConfig): FrozenEvaluationProfile {
  if (!config.enabled || config.locked) throw new Error('Evaluation target profile is disabled or locked');
  return {
    id: config.id, label: config.label, systemPrompt: config.systemPrompt,
    revision: config.revision ?? 0, allowedMcpsJson: config.allowedMcpsJson,
    allowedSkillsJson: config.allowedSkillsJson, corePermissionsJson: config.corePermissionsJson,
    allowedDelegatesJson: config.allowedDelegatesJson, isManager: config.isManager,
    modelProvider: config.modelProvider, modelId: config.modelId,
  };
}

function freezeSkill(skill: AgentSkill): FrozenEvaluationSkill {
  return {
    id: skill.id, title: skill.title, body: skill.body,
    description: skill.description, whenToUse: skill.whenToUse,
    version: skill.version, status: skill.status, confidence: skill.confidence,
    stepsJson: skill.stepsJson, tagsJson: skill.tagsJson,
  };
}

/**
 * Read only the rows needed to reconstruct a target's behavior. Account IDs,
 * credentials, user sessions, and unrelated application rows are never read
 * into the snapshot. Owner-scoped schedules enforce the same visibility rule
 * as Org Reviewer before any fixture bytes are written.
 */
export async function captureOrgEvaluationTargetAsync(input: {
  kind: OrgEvaluationProposalKind;
  targetRef: string;
  expectedRevision: string;
  ownerUserId: number | null;
  change?: Record<string, unknown>;
  evidenceSessionIds?: string[];
}): Promise<OrgEvaluationTargetSnapshot> {
  const creation = await captureCreationTargetAsync(input);
  if (creation) return creation;
  const configs = new AgentConfigsRepository();
  const skills = new AgentSkillsRepository();
  const profiles: FrozenEvaluationProfile[] = [];
  const capturedSkills: FrozenEvaluationSkill[] = [];
  const schedules: FrozenEvaluationSchedule[] = [];
  const recipes: FrozenEvaluationRecipe[] = [];
  const managedSkillFiles: OrgEvaluationTargetSnapshot['managedSkillFiles'] = [];
  const managedSkillAbsences: string[] = [];
  const ownerCanRead = (owner: number | null): boolean => input.ownerUserId === null
    ? owner === null : owner === null || owner === input.ownerUserId;
  const addProfile = (id: string): void => {
    if (profiles.some((profile) => profile.id === id)) return;
    const config = configs.getById(id);
    if (!config) throw new Error(`Evaluation profile dependency '${id}' is missing`);
    profiles.push(freezeProfile(config));
  };
  const addSkill = (nameOrId: string, requireDbRow = false): void => {
    const skill = skills.getById(nameOrId) ?? skills.findByName(nameOrId);
    if (!skill && requireDbRow) throw new Error(`Evaluation skill target '${nameOrId}' has no database row`);
    if (skill && !capturedSkills.some((entry) => entry.id === skill.id)) capturedSkills.push(freezeSkill(skill));
    const name = skill?.title ?? nameOrId;
    freezeEvaluationManagedSkillDependency(name, managedSkillFiles, managedSkillAbsences);
  };
  let targetRevision: string;
  if (input.targetRef.startsWith('agent_config:')) {
    const id = input.targetRef.slice('agent_config:'.length);
    addProfile(id);
    const profile = profiles[0];
    targetRevision = String(profile.revision);
    for (const name of namesFromJson(profile.allowedSkillsJson)) addSkill(name);
    for (const delegate of namesFromJson(profile.allowedDelegatesJson)) addProfile(delegate);
  } else if (input.targetRef.startsWith('skill:')) {
    addSkill(input.targetRef.slice('skill:'.length), true);
    targetRevision = String(capturedSkills[0].version);
  } else if (input.targetRef.startsWith('scheduled_task:')) {
    const id = input.targetRef.slice('scheduled_task:'.length);
    const task = await new AgentScheduledTasksRepository().findByIdAsync(id);
    if (!task || !ownerCanRead(task.createdByUserId)) {
      throw new Error('Evaluation schedule is outside the authorized owner scope');
    }
    targetRevision = task.updatedAt;
    schedules.push({
      id: task.id, name: task.name, description: task.description, prompt: task.prompt,
      agentKind: task.agentKind, agentConfigId: task.agentConfigId,
      modelProvider: task.modelProvider, modelId: task.modelId, enabled: task.enabled,
      scheduleType: task.scheduleType, scheduledTime: task.scheduledTime,
      scheduledDay: task.scheduledDay, timezone: task.timezone,
      cronExpression: task.cronExpression, runAt: task.runAt,
      allowedMcpsJson: task.allowedMcpsJson, allowedSkillsJson: task.allowedSkillsJson,
    });
    if (task.agentConfigId) addProfile(task.agentConfigId);
    for (const name of namesFromJson(task.allowedSkillsJson)) addSkill(name);
  } else if (input.targetRef.startsWith('recipe:')) {
    const recipe = await new AgentCookbookRepository().findByIdAsync(input.targetRef.slice('recipe:'.length));
    if (!recipe || !ownerCanRead(recipe.ownerUserId)) {
      throw new Error('Evaluation recipe is outside the authorized owner scope');
    }
    targetRevision = recipe.updatedAt;
    recipes.push({
      id: recipe.id, title: recipe.title, description: recipe.description,
      stepsJson: recipe.stepsJson, boundConfigId: recipe.boundConfigId,
      schemaVersion: recipe.schemaVersion, definitionJson: recipe.definitionJson,
    });
    if (recipe.boundConfigId) addProfile(recipe.boundConfigId);
  } else {
    throw new Error(`Evaluation targetRef '${input.targetRef}' has no isolated snapshot adapter`);
  }
  if (targetRevision !== input.expectedRevision) throw new Error('Evaluation target revision changed before capture');
  if (input.kind === 'consolidate-skill') {
    const retired = input.change?.retiredSkillId ?? input.change?.retiredSkillName;
    if (typeof retired !== 'string' || !retired) throw new Error('Evaluation consolidation lacks retired skill');
    addSkill(retired, true);
  }
  // Skills and unbound recipes/tasks have no profile foreign key. The
  // verified transcripts identify the real execution profile; an empty
  // profile list would silently exercise a different/default agent.
  if (!profiles.length) {
    profiles.push(await captureEvidenceBaselineProfileAsync(input));
    if (input.targetRef.startsWith('skill:')) {
      const allowed = profiles[0].allowedSkillsJson;
      const selected = capturedSkills[0];
      if (allowed !== null && !namesFromJson(allowed).some((name) =>
        name === selected.id || name === selected.title || name === slugForSkillName(selected.title))) {
        throw new Error('Verified baseline profile cannot load the reviewed skill');
      }
    }
  }
  if (input.evidenceSessionIds?.length) {
    const citedProfile = await captureEvidenceBaselineProfileAsync(input);
    const reviewedProfile = input.targetRef.startsWith('agent_config:')
      ? input.targetRef.slice('agent_config:'.length)
      : schedules[0]?.agentConfigId ?? recipes[0]?.boundConfigId ?? profiles[0]?.id;
    if (citedProfile.id !== reviewedProfile) {
      throw new Error('Cited sessions do not belong to the reviewed target profile or its bound dependency');
    }
  }
  if (profiles.some((profile) => profile.allowedSkillsJson === null))
    throw new Error('Unrestricted profile skill scope has no bounded evaluation inventory');
  for (const profile of profiles) {
    for (const name of namesFromJson(profile.allowedSkillsJson)) addSkill(name);
  }
  const primary = profiles[0];
  const task = schedules[0];
  const effectiveModel = captureEffectiveEvaluationModel({
    profileId: primary.id, profileModelProvider: primary.modelProvider, profileModelId: primary.modelId,
    scheduledModelProvider: task?.modelProvider, scheduledModelId: task?.modelId,
  });
  const publicationOriginal = input.kind === 'publish-skill-to-org'
    ? await captureOrgPublicationStateAsync({ skillName: capturedSkills[0].title })
    : undefined;
  const externalSkillSource = input.kind === 'external-adoption' && input.change?.candidateKind === 'skill'
    ? await captureExternalSkillSourceAsync({ change: input.change })
    : undefined;
  return {
    schemaVersion: 1, effectiveModel, kind: input.kind, targetRef: input.targetRef, targetRevision,
    profiles, skills: capturedSkills, schedules, recipes, managedSkillFiles,
    managedSkillAbsences,
    ...(publicationOriginal ? { publicationOriginal } : {}),
    ...(externalSkillSource ? { externalSkillSource } : {}),
  };
}

function insertKnown(db: Database.Database, table: string, row: Record<string, unknown>): void {
  const available = new Set((db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name));
  const columns = Object.keys(row).filter((column) => available.has(column));
  const quoted = columns.map((column) => `"${column}"`).join(',');
  db.prepare(`INSERT OR REPLACE INTO ${table} (${quoted}) VALUES (${columns.map(() => '?').join(',')})`)
    .run(...columns.map((column) => row[column] ?? null));
}

function validateText(text: string | null, subject: string): void {
  if (text === null) return;
  if (text.length > 128_000 || scanContextContent(text, subject).blocked) {
    throw new Error(`Evaluation snapshot ${subject} is unsafe or too large`);
  }
}

/**
 * Parent captures a small allowlisted snapshot and passes it here. This writes
 * only to a new private directory. No live DB backup or credential copy occurs.
 */
export function prepareOrgEvaluationFixture(
  snapshot: OrgEvaluationTargetSnapshot,
  options: { fixtureRoot: string; safeMcpCommand: string[]; providerRelayUrl: string;
    relayToken: string; executionModel?: { providerID: string; modelID: string };
    publicationBaseURL?: string; managedMcpCommand?: string[] },
): PreparedOrgEvaluationFixture {
  const root = resolve(options.fixtureRoot);
  if (!root.startsWith('/private/tmp/') || existsSync(root) || snapshot.schemaVersion !== 1 ||
      !snapshot.targetRef || !snapshot.targetRevision || !options.relayToken ||
      options.safeMcpCommand.length !== 2 || options.safeMcpCommand[0] !== process.execPath ||
      ![join(__dirname, 'org_evaluation_mcp_fixture.js'),
        join(__dirname, 'org_evaluation_mcp_fixture.ts')].includes(options.safeMcpCommand[1])) {
    throw new Error('Evaluation fixture inputs are not approved');
  }
  if (options.managedMcpCommand && (options.managedMcpCommand.length !== 2 ||
      options.managedMcpCommand[0] !== process.execPath ||
      options.managedMcpCommand[1] !== join(__dirname, 'org_evaluation_managed_mcp_shim.js'))) {
    throw new Error('Evaluation managed MCP command is not code-owned');
  }
  const frozenModel = snapshot.effectiveModel;
  if (!frozenModel || !['profile', 'scheduled-task', 'mru', 'hardcoded-default'].includes(frozenModel.source)
    || !/^[a-zA-Z0-9._-]{1,80}$/.test(frozenModel.providerID)
    || !/^[a-zA-Z0-9._/-]{1,120}$/.test(frozenModel.modelID))
    throw new Error('Evaluation fixture requires an exact frozen production model');
  const executionModel = options.executionModel ?? frozenModel;
  if (!((executionModel.providerID === 'anthropic' && executionModel.modelID.startsWith('claude-')) ||
      (executionModel.providerID === 'openai' && /^[A-Za-z0-9._-]{1,120}$/.test(executionModel.modelID)))) {
    throw new Error('Evaluation fixture has no bounded provider transport for the actual model');
  }
  const relay = new URL(options.providerRelayUrl);
  if (options.publicationBaseURL) {
    const publication = new URL(options.publicationBaseURL);
    if (publication.protocol !== 'http:' || publication.hostname !== '127.0.0.1' ||
        !publication.port || publication.pathname !== '/' || publication.search || publication.hash ||
        publication.port === relay.port || [4001, 4096, 4098].includes(Number(publication.port))) {
      throw new Error('Evaluation publication receiver must be a distinct private loopback origin');
    }
  }
  if (relay.protocol !== 'http:' || relay.hostname !== '127.0.0.1' || !relay.port ||
      relay.username || relay.password || relay.search || relay.hash ||
      !/^\/agent-org-proposals\/evaluations\/provider\/[A-Za-z0-9_-]+\/v1$/.test(relay.pathname)) {
    throw new Error('Evaluation fixture requires a private provider relay');
  }
  if (snapshot.profiles.length > 32 || snapshot.skills.length > 128 || snapshot.schedules.length > 32 ||
      snapshot.recipes.length > 32 ||
      snapshot.managedSkillFiles.length > 128 ||
      (snapshot.managedSkillAbsences?.length ?? 0) > 128) throw new Error('Evaluation snapshot exceeds dependency limits');
  if (snapshot.managedSkillAbsences?.some((name) => snapshot.managedSkillFiles.some((file) => file.name === name)))
    throw new Error('Evaluation skill cannot be both present and absent');
  const fixtureDb = join(root, 'rhythm.db');
  const fixtureConfig = join(root, 'opencode-config');
  mkdirSync(fixtureConfig, { recursive: true, mode: 0o700 });
  const db = new Database(fixtureDb);
  try {
    runMigrations(db);
    db.transaction(() => {
      if (frozenModel.source === 'mru') {
        // Reproduce resolveRunModel's fallback in the empty private database.
        // This row contains only model metadata and fixed synthetic placeholders.
        insertKnown(db, 'agent_sessions', { id: 'evaluation-model-only-mru',
          agent_kind: 'opencode', cwd: root, name: 'Evaluation model metadata',
          provider_id: frozenModel.providerID, model_id: frozenModel.modelID,
          created_at: '2099-01-01T00:00:00.000Z', updated_at: '2099-01-01T00:00:00.000Z' });
      }
      for (const profile of snapshot.profiles) {
        validateText(profile.systemPrompt, `profile ${profile.id}`);
        insertKnown(db, 'agent_configs', {
          id: profile.id, label: profile.label, icon: 'fixture', command: 'opencode',
          enabled: 1, is_agent: 1, is_manager: Number(profile.isManager),
          system_prompt: profile.systemPrompt, revision: profile.revision,
          allowed_mcps_json: profile.allowedMcpsJson,
          allowed_skills_json: profile.allowedSkillsJson,
          core_permissions_json: profile.corePermissionsJson,
          allowed_delegates_json: profile.allowedDelegatesJson,
          model_provider: profile.modelProvider, model_id: profile.modelId,
          oc_agent: profile.id, session_selectable: 1, schedulable: 1,
          default_anthropic_account_id: null, default_openai_account_id: null,
          auto_approve_actions: 0, image_generation_enabled: 0,
        });
      }
      for (const skill of snapshot.skills) {
        validateText(skill.body, `skill ${skill.id}`);
        insertKnown(db, 'agent_skills', {
          id: skill.id, title: skill.title, body: skill.body,
          description: skill.description, when_to_use: skill.whenToUse,
          version: skill.version, status: skill.status ?? 'active', confidence: skill.confidence ?? 1,
          steps_json: skill.stepsJson, tags_json: skill.tagsJson, source: 'evaluation-fixture',
        });
      }
      for (const task of snapshot.schedules) {
        validateText(task.prompt, `schedule ${task.id}`);
        insertKnown(db, 'agent_scheduled_tasks', {
          id: task.id, name: task.name, description: task.description,
          prompt: task.prompt, agent_kind: task.agentKind, agent_config_id: task.agentConfigId,
          model_provider: task.modelProvider, model_id: task.modelId, enabled: Number(task.enabled),
          schedule_type: task.scheduleType, scheduled_time: task.scheduledTime,
          scheduled_day: task.scheduledDay, timezone: task.timezone, cron_expression: task.cronExpression,
          run_at: task.runAt, allowed_mcps_json: task.allowedMcpsJson,
          allowed_skills_json: task.allowedSkillsJson, created_by_user_id: null,
        });
      }
      for (const recipe of snapshot.recipes) {
        validateText(recipe.stepsJson, `recipe ${recipe.id}`);
        validateText(recipe.definitionJson, `recipe definition ${recipe.id}`);
        insertKnown(db, 'agent_cookbook', {
          id: recipe.id, title: recipe.title, description: recipe.description,
          steps_json: recipe.stepsJson, bound_config_id: recipe.boundConfigId,
          owner_user_id: null, schema_version: recipe.schemaVersion,
          definition_json: recipe.definitionJson,
        });
      }
    })();
  } finally {
    db.close();
  }
  for (const file of snapshot.managedSkillFiles) {
    const bytes = Buffer.from(file.bytesBase64, 'base64');
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error('Evaluation managed skill bytes changed');
    }
    validateText(bytes.toString('utf8'), `managed skill ${file.name}`);
    const dir = join(fixtureConfig, 'skills', slugForSkillName(file.name));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, 'SKILL.md');
    writeFileSync(path, bytes, { mode: 0o400 });
    chmodSync(path, 0o400);
  }
  const config = {
    mcp: { 'evaluation-fixture': { type: 'local', command: options.safeMcpCommand },
      ...(options.managedMcpCommand ? { rhythm: { type: 'local', command: options.managedMcpCommand } } : {}) },
    provider: { [executionModel.providerID]: { options: {
      baseURL: options.providerRelayUrl, apiKey: options.relayToken,
    } } },
    ...(options.publicationBaseURL ? { skills: { urls: [`${options.publicationBaseURL}/org-skills`] } } : {}),
  };
  const configPath = join(fixtureConfig, 'opencode.json');
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o400 });
  chmodSync(configPath, 0o400);
  chmodSync(fixtureDb, 0o400);
  return {
    fixtureRoot: root, fixtureDb, fixtureConfig,
    sourceHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
  };
}
