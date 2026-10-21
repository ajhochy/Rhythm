/**
 * Disposable evaluation worker. This module must run with a private HOME and
 * copied SQLite database. It never starts api_server or mutates the source
 * fixture. The parent API passes an ephemeral provider relay for task probes.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { OrgEvaluationProposalKind } from '../models/org_evaluation';
import { retiredSkillUnavailableEvent, skillNotFoundEvent } from './org_evaluation_skill_absence';

export interface EvaluationMaterializeRequest {
  candidateId: string;
  kind: OrgEvaluationProposalKind;
  targetRef: string;
  changeJson: string | null;
  baseline: boolean;
  /** The copied, writable database inside this worker's private root. */
  dbPath: string;
  workerRoot: string;
  profileIds?: string[];
  executionModel: { providerID: string; modelID: string };
  proposal: { title: string; rationale: string; securityNote: string | null };
  bootstrapEngine?: boolean;
  workspacePath?: string;
  publicationName?: string;
}

export interface EvaluationMaterializedConfiguration {
  manifestJson: string;
  manifestHash: string;
  applied: boolean;
  effectEvents: string[];
}

export interface EvaluationExecuteRequest extends EvaluationMaterializeRequest {
  expectedManifestHash: string;
  task: { key: string; prompt: string; outputIncludes: string[]; outputExcludes: string[] };
  model: { providerID: string; modelID: string };
  workspacePath: string;
  guardSentinelPath: string;
  guardNetworkUrl: string;
}

export interface EvaluationWorkerExecution {
  sessionId: string;
  engineVersion: string;
  engineBootId: string;
  manifestHash: string;
  taskFixtureHash: string;
  output: string;
  outputHash: string;
  toolEvents: Array<{ type: string; name: string; status: string; callId: string;
    outputHash: string | null; evidenceHash: string;
    dispatch: { family: string; action: string; name: string; argumentsHash: string | null } | null }>;
  fixtureToolEvents: Array<{ tool: string; outputHash: string }>;
  negativeGuardsPassed: boolean;
  guardDetails: { hostReadDenied: boolean; hostWriteDenied: boolean; networkDenied: boolean;
    parentApiDenied: boolean; processSignalDenied: boolean };
  observedEffects: Array<{
    kind: string; source: 'worker-db' | 'worker-file' | 'engine-session' | 'engine-tool' |
      'engine-permission' | 'loopback-receiver' | 'docker-vetter';
    subject: string; evidenceHash: string;
  }>;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function workerBoundary(request: EvaluationMaterializeRequest): void {
  const root = resolve(request.workerRoot);
  const dbPath = resolve(request.dbPath);
  const home = resolve(process.env.HOME ?? '');
  if (process.env.RHYTHM_EVALUATION_WORKER !== '1' ||
      process.env.DB_CLIENT !== 'sqlite' ||
      process.env.DB_PATH !== dbPath ||
      !root.startsWith('/private/tmp/') ||
      relative(root, dbPath).startsWith('..') ||
      relative(root, home).startsWith('..') ||
      !existsSync(dbPath) || lstatSync(dbPath).isSymbolicLink()) {
    throw new Error('Evaluation worker is outside its isolated copied database');
  }
}

function selectedEvaluationProfileId(request: EvaluationMaterializeRequest): string | undefined {
  if (request.kind === 'create-agent' && request.baseline) return request.profileIds?.[0];
  return request.targetRef.startsWith('agent_config:')
    ? request.targetRef.slice('agent_config:'.length) : request.profileIds?.[0];
}

async function assertAppliedEvaluationModel(request: EvaluationMaterializeRequest,
  db: Database.Database): Promise<void> {
  const profileId = selectedEvaluationProfileId(request);
  if (!profileId) throw new Error('Evaluation has no frozen execution profile');
  const { resolveRunModel } = await import('./agent_runner');
  let actual = resolveRunModel(profileId);
  if (request.targetRef.startsWith('scheduled_task:')) {
    const taskId = request.targetRef.slice('scheduled_task:'.length);
    const task = db.prepare('SELECT agent_config_id, model_provider, model_id FROM agent_scheduled_tasks WHERE id = ?')
      .get(taskId) as { agent_config_id: string | null; model_provider: string | null; model_id: string | null } | undefined;
    if (!task || task.agent_config_id !== profileId) throw new Error('Evaluation scheduled task binding changed');
    if (task.model_provider && task.model_id) actual = { providerID: task.model_provider, modelID: task.model_id };
  }
  if (actual.providerID !== request.executionModel.providerID ||
      actual.modelID !== request.executionModel.modelID) {
    throw new Error('Applied candidate resolves to a different production model');
  }
}

function hashPrivateFiles(root: string, selectedProvider: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(root)) return result;
  const walk = (path: string): void => {
    for (const child of readdirSync(path)) {
      const absolute = join(path, child);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('Evaluation worker configuration gained a symlink');
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) {
        const fileName = relative(root, absolute);
        // OpenCode creates this package-manager housekeeping file lazily on
        // first session use. It is outside the effective agent/tool policy.
        if (fileName === '.gitignore') continue;
        if (fileName === 'opencode.json') {
          // A fresh relay lease is minted for every arm. Its URL and dummy key
          // are transport details, not part of the target's effective policy.
          const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
          const provider = parsed.provider as Record<string, unknown> | undefined;
          const selected = provider?.[selectedProvider] as Record<string, unknown> | undefined;
          const options = selected?.options as Record<string, unknown> | undefined;
          if (options) {
            options.baseURL = '<private-budget-relay>';
            options.apiKey = '<ephemeral-relay-token>';
          }
          const skills = parsed.skills as { urls?: string[] } | undefined;
          if (skills?.urls && process.env.RHYTHM_EVALUATION_PUBLICATION_URL) {
            const privateUrl = `${process.env.RHYTHM_EVALUATION_PUBLICATION_URL}/org-skills`;
            skills.urls = skills.urls.map((url) => url === privateUrl ? '<private-org-skills>' : url);
          }
          result[fileName] = sha256(JSON.stringify(parsed));
        } else result[fileName] = sha256(readFileSync(absolute));
      }
      else throw new Error('Evaluation worker configuration has unsupported file');
    }
  };
  walk(root);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

const NON_BEHAVIOR_COLUMNS = new Set([
  'created_at', 'updated_at', 'last_run_at', 'last_triggered_at',
  'last_status', 'last_error', 'run_count', 'revision',
]);

function canonicalRows(rows: unknown[], table: string,
  target?: { kind: OrgEvaluationProposalKind; targetRef: string }): string {
  return JSON.stringify(rows.map((row) => {
    const record = row as Record<string, unknown>;
    const semantic = { ...record };
    if (target?.kind === 'create-recipe' && table === 'agent_cookbook' &&
        typeof semantic.title === 'string' && target.targetRef === `recipe:${semantic.title}`) {
      if (typeof semantic.id !== 'string' || !/^[a-f0-9-]{36}$/.test(semantic.id))
        throw new Error('Generated recipe ID has an unexpected form');
      semantic.id = `generated-recipe:${semantic.title}`;
    }
    if (target?.kind === 'webhook-wiring' && table === 'agent_webhook_endpoints' &&
        typeof semantic.name === 'string' &&
        [semantic.name, `webhook:${semantic.name}`].includes(target.targetRef)) {
      if (typeof semantic.id !== 'string' || !/^[a-f0-9-]{36}$/.test(semantic.id) ||
          typeof semantic.secret !== 'string' || !/^[a-f0-9]{32}$/.test(semantic.secret)) {
        throw new Error('Generated webhook identity or secret has an unexpected form');
      }
      semantic.id = `generated-webhook:${semantic.name}`;
      semantic.secret = '<random-32-hex-hmac-secret>';
    }
    return Object.fromEntries(Object.entries(semantic)
      .filter(([key]) => !NON_BEHAVIOR_COLUMNS.has(key))
      .sort(([left], [right]) => left.localeCompare(right)));
  }));
}

/** Bind the actual copied DB and projected files without returning any secret bytes. */
export function readEvaluationEffectiveManifest(
  db: Database.Database, homePath: string,
  executionModel: { providerID: string; modelID: string },
  target?: { kind: OrgEvaluationProposalKind; targetRef: string; publicationStateHash?: string },
): {
  manifestJson: string; manifestHash: string;
} {
  const tables = [
    'agent_configs', 'agent_skills', 'agent_scheduled_tasks',
    'agent_cookbook', 'agent_webhook_endpoints',
  ];
  const tableHashes: Record<string, string> = {};
  for (const table of tables) {
    const present = db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', table);
    if (!present) continue;
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    tableHashes[table] = sha256(canonicalRows(rows, table, target));
  }
  const configRoot = join(homePath, '.config', 'opencode');
  const manifestJson = JSON.stringify({ schemaVersion: 1, executionModel,
    tableHashes, fileHashes: hashPrivateFiles(configRoot, executionModel.providerID),
    ...(target?.publicationStateHash ? { publicationStateHash: target.publicationStateHash } : {}) });
  return { manifestJson, manifestHash: sha256(manifestJson) };
}

async function readPrivatePublicationState(name: string | undefined): Promise<{
  stateHash: string; published: boolean; bodyHash: string | null;
}> {
  const base = process.env.RHYTHM_EVALUATION_PUBLICATION_URL;
  if (!base || !name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(name)) {
    throw new Error('Evaluation publication state has no private receiver binding');
  }
  const root = `${base}/org-skills`;
  const index = await fetch(`${root}/index.json`, { signal: AbortSignal.timeout(5000),
    headers: { 'X-Rhythm-Evaluation-Verify': '1' } });
  if (!index.ok) throw new Error('Evaluation org-skill index read failed');
  const list = await index.json() as { skills?: Array<{ name?: string; files?: string[] }> };
  if (!Array.isArray(list.skills)) throw new Error('Evaluation org-skill index malformed');
  const matches = list.skills.filter((entry) => entry.name === name);
  if (matches.length > 1 || list.skills.some((entry) => !entry || typeof entry.name !== 'string')) {
    throw new Error('Evaluation org-skill index ambiguous');
  }
  const body = await fetch(`${root}/${encodeURIComponent(name)}/SKILL.md`,
    { signal: AbortSignal.timeout(5000), headers: { 'X-Rhythm-Evaluation-Verify': '1' } });
  if (!matches.length) {
    if (body.status !== 404) throw new Error('Evaluation org-skill absence disagrees with index');
    return { published: false, bodyHash: null,
      stateHash: sha256(JSON.stringify({ name, published: false })) };
  }
  if (!matches[0].files?.includes('SKILL.md') || !body.ok) {
    throw new Error('Evaluation org-skill body disagrees with index');
  }
  const bytes = Buffer.from(await body.arrayBuffer());
  if (!bytes.length || bytes.length > 256 * 1024) throw new Error('Evaluation org-skill body size invalid');
  const bodyHash = sha256(bytes);
  return { published: true, bodyHash,
    stateHash: sha256(JSON.stringify({ name, published: true, bodyHash })) };
}

/**
 * Reuses the same validator and applier as human approval, but on a copied DB.
 * Side-effecting external install/publication kinds require dedicated confined
 * adapters and are refused here before any proposal row is created.
 */
export async function materializeOrgEvaluationCandidateAsync(
  request: EvaluationMaterializeRequest,
): Promise<EvaluationMaterializedConfiguration> {
  workerBoundary(request);
  const externalChange = request.kind === 'external-adoption' && !request.baseline
    ? JSON.parse(request.changeJson ?? 'null') as { candidateKind?: unknown } : null;
  if (!request.baseline && (!request.changeJson ||
      request.kind === 'tool-install' ||
      request.kind === 'external-adoption' && externalChange?.candidateKind !== 'skill')) {
    throw new Error(`Evaluation kind '${request.kind}' requires its isolated external/specialized applier`);
  }
  const db = new Database(request.dbPath);
  const { setDb } = await import('../database/db');
  const previous = setDb(db);
  try {
    const effectEvents: string[] = [];
    if (request.profileIds?.length) {
      const { AgentConfigsRepository } = await import('../repositories/agent_configs_repository');
      const { writeAgentProfileFile } = await import('./opencode_agent_writer');
      const profiles = new AgentConfigsRepository();
      for (const id of request.profileIds) {
        const profile = profiles.getById(id);
        if (!profile || writeAgentProfileFile(profile) !== 'written') {
          throw new Error(`Evaluation baseline profile '${id}' could not be projected`);
        }
      }
    }
    if (!request.baseline) {
      const { registerAllProposalAppliers } = await import('./org_proposal_appliers_wiring');
      const { applyApprovedProposalAsync } = await import('./org_proposal_apply_service');
      const { AgentOrgProposalsRepository } = await import('../repositories/agent_org_proposals_repository');
      registerAllProposalAppliers();
      const repo = new AgentOrgProposalsRepository();
      const proposal = await repo.createAsync({
        id: request.candidateId, kind: request.kind, targetRef: request.targetRef,
        changeJson: request.changeJson, risk: 'high', status: 'proposed',
        title: request.proposal.title, rationale: request.proposal.rationale,
        provenanceJson: JSON.stringify({ securityNote: request.proposal.securityNote }),
      });
      const outcome = await applyApprovedProposalAsync({
        proposal, decidedByUserId: 0, proposalsRepo: repo,
        finalizePostApply: async () => null,
        measure: async () => 'skipped',
      });
      if (outcome.kind !== 'applied') {
        throw new Error(`Evaluation candidate did not apply in copied database: ${outcome.kind}${
          'reason' in outcome ? ` (${outcome.reason})` : ''}`);
      }
      effectEvents.push('candidate-applied-to-worker-db');
    }
    await assertAppliedEvaluationModel(request, db);
    if (request.bootstrapEngine) {
      if (!request.workspacePath) throw new Error('Evaluation prepare requires a private workspace');
      const { OpencodeClientService } = await import('./opencode_client_service');
      const engine = new OpencodeClientService();
      try { await engine.initialize({ directory: request.workspacePath }); }
      finally { engine.dispose(); }
    }
    const publicationStateHash = request.kind === 'publish-skill-to-org'
      ? (await readPrivatePublicationState(request.publicationName)).stateHash : undefined;
    const manifest = readEvaluationEffectiveManifest(db, process.env.HOME!, request.executionModel,
      { kind: request.kind, targetRef: request.targetRef, publicationStateHash });
    return { ...manifest, applied: !request.baseline, effectEvents };
  } finally {
    setDb(previous);
    db.close();
  }
}

function denied(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EACCES';
}

async function checkNegativeGuards(request: EvaluationExecuteRequest): Promise<EvaluationWorkerExecution['guardDetails']> {
  let hostReadDenied = false;
  let hostWriteDenied = false;
  let networkDenied = false;
  let parentApiDenied = true;
  let processSignalDenied = false;
  try { readFileSync(request.guardSentinelPath); } catch (error) { hostReadDenied = denied(error); }
  try { appendFileSync(request.guardSentinelPath, 'blocked'); } catch (error) { hostWriteDenied = denied(error); }
  try {
    await fetch(request.guardNetworkUrl, { signal: AbortSignal.timeout(2000) });
  } catch (error) {
    networkDenied = denied((error as Error & { cause?: unknown }).cause ?? error);
  }
  for (const port of [4000, 4001, 4098]) {
    try { await fetch(`http://127.0.0.1:${port}/agent-configs`, { signal: AbortSignal.timeout(2000) });
      parentApiDenied = false;
    } catch (error) {
      parentApiDenied &&= denied((error as Error & { cause?: unknown }).cause ?? error);
    }
  }
  try { process.kill(process.ppid, 0); } catch (error) { processSignalDenied = denied(error); }
  return { hostReadDenied, hostWriteDenied, networkDenied, parentApiDenied, processSignalDenied };
}

/** Run a real private engine session after exact candidate rematerialization. */
export async function executeOrgEvaluationTaskAsync(request: EvaluationExecuteRequest): Promise<EvaluationWorkerExecution> {
  workerBoundary(request);
  if (request.model.providerID !== request.executionModel.providerID ||
      request.model.modelID !== request.executionModel.modelID) {
    throw new Error('Evaluation dispatch model differs from frozen effective manifest');
  }
  await materializeOrgEvaluationCandidateAsync(request);
  const guards = await checkNegativeGuards(request);
  if (!Object.values(guards).every(Boolean)) throw new Error('Evaluation sandbox negative guard was not proved');
  const fixtureBytes = readFileSync(join(request.workspacePath, 'fixtures', 'request.json'));
  if (fixtureBytes.toString('utf8') !== JSON.stringify({ key: request.task.key, prompt: request.task.prompt })) {
    throw new Error('Evaluation task fixture differs from frozen prompt');
  }
  const db = new Database(request.dbPath);
  const { setDb } = await import('../database/db');
  const previous = setDb(db);
  const { OpencodeClientService } = await import('./opencode_client_service');
  const engine = new OpencodeClientService();
  const bootId = sha256(`${process.pid}:${Date.now()}:${request.workerRoot}`);
  const sessionScope = async (selectedProfileId?: string, scheduledTaskId?: string) => {
    if (!selectedProfileId) return { mcpRoleConfig: undefined, skillAllowlist: undefined };
    const { resolveProfileScope } = await import('./agent_profile_scope');
    let override: { allowedMcpsJsonOverride?: string | null; allowedSkillsJsonOverride?: string | null } = {};
    if (scheduledTaskId) {
      const { AgentScheduledTasksRepository } = await import('../repositories/agent_scheduled_tasks_repository');
      const task = await new AgentScheduledTasksRepository().findByIdAsync(scheduledTaskId);
      if (!task || task.agentConfigId !== selectedProfileId) {
        throw new Error('Routed evaluation schedule profile binding changed');
      }
      if ((task.modelProvider && task.modelProvider !== request.executionModel.providerID) ||
          (task.modelId && task.modelId !== request.executionModel.modelID)) {
        throw new Error('Routed evaluation task model differs from frozen execution model');
      }
      override = { allowedMcpsJsonOverride: task.allowedMcpsJson,
        allowedSkillsJsonOverride: task.allowedSkillsJson };
    }
    const scope = await resolveProfileScope(selectedProfileId, override);
    const actualModel = scheduledTaskId
      ? await (async () => {
        const { AgentScheduledTasksRepository } = await import('../repositories/agent_scheduled_tasks_repository');
        const task = await new AgentScheduledTasksRepository().findByIdAsync(scheduledTaskId);
        return task?.modelProvider && task.modelId
          ? { providerID: task.modelProvider, modelID: task.modelId } : scope.model;
      })() : scope.model;
    if (actualModel.providerID !== request.executionModel.providerID ||
        actualModel.modelID !== request.executionModel.modelID) {
      throw new Error('Routed evaluation profile model differs from frozen execution model');
    }
    const decoded: unknown = scope.allowedSkillsJson === null ? undefined : JSON.parse(scope.allowedSkillsJson);
    if (decoded !== undefined && (!Array.isArray(decoded) || !decoded.every((item) => typeof item === 'string'))) {
      throw new Error('Routed evaluation skill scope is malformed');
    }
    return { mcpRoleConfig: scope.mcpRoleConfig ?? undefined,
      skillAllowlist: decoded as string[] | undefined };
  };
  try {
    await engine.initialize({ directory: request.workspacePath });
    const publicationBefore = request.kind === 'publish-skill-to-org'
      ? await readPrivatePublicationState(request.publicationName) : undefined;
    const projected = readEvaluationEffectiveManifest(db, process.env.HOME!, request.executionModel,
      { kind: request.kind, targetRef: request.targetRef,
        publicationStateHash: publicationBefore?.stateHash });
    if (projected.manifestHash !== request.expectedManifestHash) {
      throw new Error('Evaluation candidate effective configuration changed between prepare and run');
    }
    const profileId = selectedEvaluationProfileId(request);
    const primaryScheduledTaskId = request.targetRef.startsWith('scheduled_task:')
      ? request.targetRef.slice('scheduled_task:'.length) : undefined;
    const primaryScope = await sessionScope(profileId, primaryScheduledTaskId);
    const session = await engine.createSession(
      `Evaluation ${request.task.key}`, request.workspacePath,
      primaryScope.mcpRoleConfig, primaryScope.skillAllowlist,
      request.model.providerID, undefined, 'default',
    );
    if (!session.id) throw new Error(session.error ?? 'Evaluation engine did not create a session');
    const response = await engine.prompt(
      session.id, request.task.prompt, request.model, request.workspacePath,
      profileId ? { agent: profileId } : {},
    );
    if (!response) throw new Error('Evaluation engine produced no response');
    const historyParts: unknown[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
      const page = await engine.listMessagesPageStrict(session.id, request.workspacePath,
        { limit: 100, ...(cursor ? { before: cursor } : {}) });
      if (!page) throw new Error('Evaluation engine history could not be read strictly');
      for (const message of page.messages) {
        if (!Array.isArray(message.parts)) throw new Error('Evaluation engine history has missing parts');
        historyParts.push(...message.parts);
      }
      if (!page.nextCursor) { cursor = undefined; break; }
      cursor = page.nextCursor;
    }
    if (cursor || historyParts.length === 0) throw new Error('Evaluation engine history was incomplete');
    const output = response.parts.filter((part) => part.type === 'text')
      .map((part) => 'text' in part ? String(part.text) : '').join('\n');
    const toolEvents = historyParts.filter((part) => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'tool')
      .map((part) => {
        const value = part as unknown as Record<string, unknown>;
        const state = value.state && typeof value.state === 'object' ? value.state as Record<string, unknown> : {};
        const rawInput = state.input && typeof state.input === 'object' && !Array.isArray(state.input)
          ? state.input as Record<string, unknown> : null;
        const dispatch = value.tool === 'mcp_dispatch' && rawInput
          ? { family: String(rawInput.family ?? 'mcp'), action: String(rawInput.action ?? ''),
              name: String(rawInput.name ?? ''),
              argumentsHash: rawInput.arguments && typeof rawInput.arguments === 'object'
                ? sha256(JSON.stringify(rawInput.arguments)) : null }
          : null;
        return { type: 'tool', name: String(value.tool ?? ''), status: String(state.status ?? ''),
          callId: String(value.callID ?? ''), outputHash: typeof state.output === 'string' ? sha256(state.output) : null,
          evidenceHash: sha256(JSON.stringify(value)), dispatch };
      });
    const ledgerPath = join(request.workerRoot, 'mcp-fixture', 'effects.jsonl');
    const fixtureToolEvents = existsSync(ledgerPath)
      ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map((line) => {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (typeof event.tool !== 'string' || typeof event.outputHash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(event.outputHash)) {
          throw new Error('Evaluation fixture tool ledger was malformed');
        }
        return { tool: event.tool, outputHash: event.outputHash };
      }) : [];
    const observedEffects: EvaluationWorkerExecution['observedEffects'] = [];
    if (profileId) {
      const projectedFile = join(process.env.HOME!, '.config', 'opencode', 'agents', `${profileId}.md`);
      if (existsSync(projectedFile)) observedEffects.push({
        kind: 'profile-projected', source: 'worker-file', subject: profileId,
        evidenceHash: sha256(readFileSync(projectedFile)),
      });
    }
    if (output.trim()) observedEffects.push({
      kind: 'agent-output', source: 'engine-session', subject: session.id, evidenceHash: sha256(output),
    });
    if (request.targetRef.startsWith('skill:')) {
      const { AgentSkillsRepository } = await import('../repositories/agent_skills_repository');
      const { readManagedSkillBytes } = await import('./rhythm_managed_skills');
      const skillId = request.targetRef.slice('skill:'.length);
      const skills = new AgentSkillsRepository();
      const skill = skills.getById(skillId) ?? skills.findByName(skillId);
      const bytes = skill ? readManagedSkillBytes(skill.title) : null;
      if (skill && bytes) observedEffects.push({
        kind: 'managed-skill-bytes-written', source: 'worker-file', subject: skill.title,
        evidenceHash: sha256(bytes),
      });
      if (skill) {
        const { extractInvokedSkillNamesFromParts } = await import('./lazy_deps_turn_hook');
        if (extractInvokedSkillNamesFromParts(historyParts as Parameters<typeof extractInvokedSkillNamesFromParts>[0]).includes(skill.title)) {
          observedEffects.push({
            kind: 'skill-loaded', source: 'engine-tool', subject: skill.title,
            evidenceHash: sha256(JSON.stringify(toolEvents)),
          });
        }
      }
    }
    if (request.kind === 'consolidate-skill' && !request.baseline) {
      const { readManagedSkillBytes } = await import('./rhythm_managed_skills');
      const retired = retiredSkillUnavailableEvent({ db, targetRef: request.targetRef,
        changeJson: request.changeJson, historyParts, readManagedBytes: readManagedSkillBytes });
      if (retired) observedEffects.push(retired);
    }
    if (request.kind === 'external-adoption' && !request.baseline) {
      const change = JSON.parse(request.changeJson!) as { candidateKind?: string; skillName?: string };
      const sourceName = change.candidateKind === 'skill' ? change.skillName : undefined;
      if (sourceName && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(sourceName)) {
        const { readManagedSkillBytes } = await import('./rhythm_managed_skills');
        const { extractInvokedSkillNamesFromParts } = await import('./lazy_deps_turn_hook');
        const bytes = readManagedSkillBytes(sourceName);
        const invoked = extractInvokedSkillNamesFromParts(
          historyParts as Parameters<typeof extractInvokedSkillNamesFromParts>[0]);
        if (bytes && sha256(bytes) === process.env.RHYTHM_EVALUATION_EXTERNAL_SOURCE_SHA256 &&
            invoked.includes(sourceName)) {
          observedEffects.push({ kind: 'adopted-capability-executed', source: 'engine-tool',
            subject: sourceName, evidenceHash: sha256(JSON.stringify(toolEvents)) });
        }
      }
    }
    if (publicationBefore) {
      const { extractInvokedSkillNamesFromParts } = await import('./lazy_deps_turn_hook');
      const invoked = extractInvokedSkillNamesFromParts(
        historyParts as Parameters<typeof extractInvokedSkillNamesFromParts>[0]);
      const name = request.publicationName!;
      if (publicationBefore.published && invoked.includes(name)) {
        observedEffects.push({ kind: 'skill-loaded', source: 'engine-tool', subject: name,
          evidenceHash: sha256(JSON.stringify(toolEvents)) });
      }
      if (!publicationBefore.published) {
        const unavailable = skillNotFoundEvent(historyParts, name);
        if (unavailable) observedEffects.push(unavailable);
      }
    }
    const publicationAfterPrompt = request.kind === 'publish-skill-to-org'
      ? await readPrivatePublicationState(request.publicationName) : undefined;
    const afterRun = readEvaluationEffectiveManifest(db, process.env.HOME!, request.executionModel,
      { kind: request.kind, targetRef: request.targetRef,
        publicationStateHash: publicationAfterPrompt?.stateHash });
    if (afterRun.manifestHash !== request.expectedManifestHash) {
      const before = JSON.parse(projected.manifestJson) as { tableHashes: Record<string, string>; fileHashes: Record<string, string> };
      const after = JSON.parse(afterRun.manifestJson) as typeof before;
      const changed = (left: Record<string, string>, right: Record<string, string>) =>
        [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => left[key] !== right[key]);
      throw new Error(`Evaluation effective configuration changed during engine execution: tables=${changed(before.tableHashes, after.tableHashes).join(',')}; files=${changed(before.fileHashes, after.fileHashes).join(',')}`);
    }
    let scoredOutput = output;
    let scoredSessionId = session.id;
    if (['create-recipe', 'refine-recipe', 'refine-task', 'webhook-wiring'].includes(request.kind)) {
      const { runRecipeScheduleEffectsAsync, proveAbsentRoutedTargetAsync } =
        await import('./org_evaluation_recipe_schedule_effects');
      if (request.baseline && (request.kind === 'create-recipe' || request.kind === 'webhook-wiring')) {
        observedEffects.push(await proveAbsentRoutedTargetAsync({ kind: request.kind,
          targetRef: request.targetRef, db, workspacePath: request.workspacePath }));
        scoredOutput = '';
      } else {
        const routed = await runRecipeScheduleEffectsAsync({
          kind: request.kind, targetRef: request.targetRef, changeJson: request.changeJson,
          db, workspacePath: request.workspacePath,
          runEngineTask: async (next) => {
            const routedScope = await sessionScope(next.profileId, next.scheduledTaskId);
            const child = await engine.createSession(`Evaluation effect ${request.task.key}`,
              request.workspacePath, routedScope.mcpRoleConfig, routedScope.skillAllowlist,
              request.model.providerID,
              undefined, 'default');
            if (!child.id) throw new Error(child.error ?? 'Evaluation effect session was not created');
            const reply = await engine.prompt(child.id, next.prompt, request.model,
              request.workspacePath, next.profileId ? { agent: next.profileId } : {});
            if (!reply) throw new Error('Evaluation effect session produced no response');
            const answer = reply.parts.filter((part) => part.type === 'text')
              .map((part) => 'text' in part ? String(part.text) : '').join('\n');
            return { sessionId: child.id, output: answer, toolEvents: [] };
          },
        });
        observedEffects.push(...routed.events);
        scoredOutput = routed.routedOutput;
        scoredSessionId = routed.routedSessionId;
      }
      const afterRouted = readEvaluationEffectiveManifest(db, process.env.HOME!, request.executionModel,
        { kind: request.kind, targetRef: request.targetRef });
      if (afterRouted.manifestHash !== request.expectedManifestHash) {
        throw new Error('Routed evaluation changed effective configuration');
      }
    }
    return {
      sessionId: scoredSessionId,
      engineVersion: sha256(readFileSync(process.env.RHYTHM_OPENCODE_BIN!)),
      engineBootId: bootId,
      manifestHash: afterRun.manifestHash,
      taskFixtureHash: sha256(fixtureBytes),
      output: scoredOutput, outputHash: sha256(scoredOutput), toolEvents, fixtureToolEvents,
      negativeGuardsPassed: true, guardDetails: guards,
      observedEffects,
    };
  } finally {
    engine.dispose();
    setDb(previous);
    db.close();
  }
}
