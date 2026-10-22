import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { test as unverified } from '@playwright/test';
import { test as packagedTest, expect, API, ObservedApi, expectedRevision, responseFor, assertResponse } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';
import { assertOwnedReviewerSchedule, terminalReviewerScheduleError,
  type ReviewerScheduleState, type ReviewerScheduleRun } from './org-evaluation-schedule-terminal';

type Row = Record<string, unknown>;
type Snapshot = { schemaVersion: 1; sourceKind: string; sourceReadOnly: boolean;
  sourceOwnerUserId: number; sourcePath: string; windowDays: number; capturedAt: string;
  excludedControlProfiles: string[]; omissions: string[];
  provenance: Array<{ sessionId: string; profileId: string; selectionRole: 'failure' | 'counterexample';
    sourceStatus: string; sourceCreatedAt: string; sourceMessageCount: number; sourceRowsSha256: string }>;
  tables: Record<'agent_configs' | 'agent_sessions' | 'agent_session_messages' |
    'agent_scheduled_tasks' | 'agent_skills' | 'agent_cookbook', Row[]> };
type Job = { id: string; budgetRootId: string | null; ownerUserId: number | null; status: string;
  targetRef: string; failureReason: string | null; finalCandidateId: string | null; qualifiedProposalId: string | null };
type Detail = { job: Job; candidates: Array<{ id: string; role: string; configHash: string; changeJson: string }>;
  results: Array<{ candidateId: string; phase: string; taskKey: string; status: string; score: number | null; receiptJson: string }>;
  budget: { maxTokens: number; settledTokens: number; outstandingTokens: number; hasUnknownUsage: boolean } };
type Proposal = { id: string; status: string; targetRef: string;
  preReviewEvaluation: { evaluationId: string; status: string; finalCandidateHash: string } | null };
type Db = { pragma(sql: string): unknown; prepare(sql: string): {
  run(...args: unknown[]): unknown; get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[] };
  transaction<T>(action: () => T): () => T; close(): void };

const requireApi = createRequire(new URL('../../../api_server/package.json', import.meta.url));
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const snapshotPath = process.env.RHYTHM_ORG_EVALUATION_REAL_SNAPSHOT_PATH;
const snapshotSha = process.env.RHYTHM_ORG_EVALUATION_REAL_SNAPSHOT_SHA256;
const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
const title = '[AI Org Reviewer] packaged owner snapshot keeps real failures and counterevidence separate from qualification';

const seedFields = {
  label: 'label', icon: 'icon', enabled: 'enabled', isAgent: 'is_agent',
  isManager: 'is_manager', systemPrompt: 'system_prompt', allowedMcpsJson: 'allowed_mcps_json',
  allowedSkillsJson: 'allowed_skills_json', corePermissionsJson: 'core_permissions_json',
  allowedDelegatesJson: 'allowed_delegates_json', modelProvider: 'model_provider',
  modelId: 'model_id', ocAgent: 'oc_agent', sessionSelectable: 'session_selectable',
  schedulable: 'schedulable', reasoningEffort: 'reasoning_effort',
  autoApproveActions: 'auto_approve_actions',
} as const;

function selectedCases(snapshot: Snapshot): string[] {
  const cases = [...new Set(snapshot.provenance.map(item => item.profileId))].sort();
  const requested = process.env.RHYTHM_ORG_EVALUATION_REAL_PROFILE_IDS?.split(',').map(id => id.trim()).filter(Boolean) ?? cases;
  if (!requested.length || new Set(requested).size !== requested.length || requested.some(id => !cases.includes(id)))
    throw new Error('Selected case profiles must be exact captured IDs');
  return requested;
}

function seedActualProfiles(snapshot: Snapshot, seedPath: string, selectedProfileIds: string[]) {
  const source = new Map(snapshot.tables.agent_configs.map(row => [String(row.id), row]));
  const original = JSON.parse(readFileSync(seedPath, 'utf8')) as { profiles: Array<{ id: string }> };
  if (!Array.isArray(original.profiles) || original.profiles.some(row => !['secretary', 'workflow-orchestrator',
      'coding-agent', 'verification-gate'].includes(row.id)))
    throw new Error('Only the untouched owned qualification profile seed may be replaced');
  const projected = new Set([...original.profiles.map(row => row.id), ...selectedProfileIds]);
  const dependencies = [...projected].flatMap(id => {
    const profile = source.get(id);
    const parsed = JSON.parse(String(profile?.allowed_delegates_json ?? '[]')) as unknown;
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string'))
      throw new Error('Actual delegate catalog is malformed');
    return parsed as string[];
  });
  for (const id of dependencies) if (projected.size < 16) projected.add(id);
  if ([...projected].some(id => !source.has(id)))
    throw new Error('A selected actual profile or its bootstrap control is absent from the snapshot');
  const profiles = [...projected].map(id => {
    const row = source.get(id)!;
    const values: Record<string, unknown> = { id, revision: row.revision };
    for (const [camel, snake] of Object.entries(seedFields)) {
      const value = row[snake];
      values[camel] = ['enabled', 'isAgent', 'isManager', 'sessionSelectable', 'autoApproveActions'].includes(camel)
        ? Boolean(value) : camel === 'schedulable' && value !== null ? Boolean(value) : value;
    }
    if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 1)
      throw new Error('Actual profile revision cannot be projected');
    return values;
  });
  writeFileSync(seedPath, JSON.stringify({ profiles }, null, 2) + '\n', { mode: 0o600 });
  return { projectedIds: [...projected], unprojectedDependencies: [...new Set(dependencies)].filter(id => !projected.has(id)) };
}

function readSnapshot(path: string, expectedSha: string, ownerUserId: number): Snapshot {
  if (!path.startsWith('/private/tmp/') || resolve(path) !== path || realpathSync(path) !== path)
    throw new Error('Actual review snapshot must be an exact private canonical path');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024)
    throw new Error('Actual review snapshot is not one private owned ordinary file');
  const bytes = readFileSync(path);
  if (!/^[a-f0-9]{64}$/.test(expectedSha) || sha256(bytes) !== expectedSha)
    throw new Error('Actual review snapshot differs from operator-pinned SHA-256');
  const value = JSON.parse(bytes.toString('utf8')) as Snapshot;
  if (value.schemaVersion !== 1 || value.sourceKind !== 'actual-electron-owner-snapshot' ||
      value.sourceReadOnly !== true || value.sourceOwnerUserId !== ownerUserId ||
      value.sourcePath === path || value.windowDays !== 14 ||
      !Array.isArray(value.provenance) || !Array.isArray(value.excludedControlProfiles) ||
      !Array.isArray(value.omissions) || !Number.isFinite(Date.parse(value.capturedAt)))
    throw new Error('Actual review snapshot provenance or owner differs from fixture');
  const names = ['agent_configs', 'agent_sessions', 'agent_session_messages',
    'agent_scheduled_tasks', 'agent_skills', 'agent_cookbook'] as const;
  if (Object.keys(value.tables ?? {}).sort().join(',') !== [...names].sort().join(',') ||
      names.some(name => !Array.isArray(value.tables[name])))
    throw new Error('Actual review snapshot contains an unexpected table collection');
  const profiles = new Set(value.tables.agent_configs.map(row => String(row.id)));
  const sessions = new Map(value.tables.agent_sessions.map(row => [String(row.id), row]));
  if (profiles.size !== value.tables.agent_configs.length || sessions.size !== value.tables.agent_sessions.length ||
      value.tables.agent_configs.some(row => value.excludedControlProfiles.includes(String(row.id))) ||
      value.tables.agent_sessions.some(row => row.owner_user_id !== null && row.owner_user_id !== ownerUserId ||
        !profiles.has(String(row.profile_id)) || row.cwd !== '__QUALIFICATION_WORKSPACE__' ||
        row.sdk_session_id !== null || row.session_token !== null || row.worktree_path !== null) ||
      value.tables.agent_session_messages.some(row => !sessions.has(String(row.session_id))) ||
      value.tables.agent_scheduled_tasks.some(row => row.created_by_user_id !== null && row.created_by_user_id !== ownerUserId) ||
      value.tables.agent_cookbook.some(row => row.owner_user_id !== null && row.owner_user_id !== ownerUserId))
    throw new Error('Actual review snapshot contains a foreign owner or live execution handle');
  for (const provenance of value.provenance) {
    const session = sessions.get(provenance.sessionId);
    if (!session || session.profile_id !== provenance.profileId ||
        session.status !== provenance.sourceStatus || session.created_at !== provenance.sourceCreatedAt ||
        !['failure', 'counterexample'].includes(provenance.selectionRole) ||
        value.tables.agent_session_messages.filter(row => row.session_id === provenance.sessionId).length !== provenance.sourceMessageCount)
      throw new Error('Actual review session provenance differs from captured evidence rows');
  }
  return value;
}

/** The destination is an already bootstrapped disposable fixture DB, never the source path. */
function importSnapshot(snapshot: Snapshot, dbPath: string, fixtureRoot: string,
  selectedProfileIds: string[], projectedProfileIds: string[]): { readbackHashes: Record<string, string>;
    selectedSessionIds: string[]; pausedRecurring: number; revisionMap: Array<{ id: string; source: number; clone: number }> } {
  const Database = requireApi('better-sqlite3') as new (path: string) => Db;
  const workspace = join(fixtureRoot, 'actual-review-workspace');
  mkdirSync(workspace, { mode: 0o700 });
  const db = new Database(dbPath);
  const selected = new Set(selectedProfileIds);
  const projected = new Set(projectedProfileIds);
  const selectedSessions = snapshot.tables.agent_sessions.filter(row => selected.has(String(row.profile_id)));
  const selectedIds = new Set(selectedSessions.map(row => String(row.id)));
  const selectedMessages = snapshot.tables.agent_session_messages.filter(row => selectedIds.has(String(row.session_id)));
  const expected: Record<string, Row[]> = {
    agent_configs: snapshot.tables.agent_configs,
    agent_skills: snapshot.tables.agent_skills,
    agent_scheduled_tasks: snapshot.tables.agent_scheduled_tasks.map(row => ({ ...row,
      // Operational safety only: preserve every other timing/configuration field.
      next_run_at: row.enabled && ['daily', 'weekly', 'monthly', 'cron'].includes(String(row.schedule_type))
        ? '2099-12-31T23:59:59.000Z' : row.next_run_at })),
    agent_cookbook: snapshot.tables.agent_cookbook,
    agent_sessions: selectedSessions.map(row => ({ ...row, cwd: workspace })),
    agent_session_messages: selectedMessages,
  };
  try {
    db.pragma('foreign_keys = ON');
    const controlProfiles = snapshot.excludedControlProfiles.map(id => db.prepare('SELECT * FROM agent_configs WHERE id=?').get(id));
    const controlSchedules = db.prepare("SELECT * FROM agent_scheduled_tasks WHERE agent_config_id='org-reviewer' ORDER BY id").all();
    const columnsFor = (table: string) => new Set((db.pragma(`table_info(${table})`) as Array<{ name: string }>).map(col => col.name));
    const insert = (table: string, row: Row) => {
      const keys = Object.keys(row);
      if (!keys.length || keys.some(key => !/^[a-z_][a-z0-9_]*$/.test(key) || !columnsFor(table).has(key)))
        throw new Error(`Actual review ${table} schema differs from frozen source`);
      db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
        .run(...keys.map(key => row[key]));
    };
    db.transaction(() => {
      for (const row of expected.agent_configs) {
        const id = String(row.id);
        const existing = db.prepare('SELECT * FROM agent_configs WHERE id=?').get(id);
        if (projected.has(id)) {
          const projection = db.prepare('SELECT projection_state,file_projected_revision FROM agent_profile_projections WHERE profile_id=?').get(id);
          if (!existing || projection?.projection_state !== 'projected' ||
              projection.file_projected_revision !== row.revision ||
              Object.values(seedFields).some(field => existing[field] !== row[field]))
            throw new Error(`Projected actual profile ${id} differs from captured semantics or revision`);
        }
        if (existing) {
          const keys = Object.keys(row).filter(key => key !== 'id');
          if (keys.some(key => !/^[a-z_][a-z0-9_]*$/.test(key) || !columnsFor('agent_configs').has(key)))
            throw new Error('Actual profile schema differs from source');
          db.prepare(`UPDATE agent_configs SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=?`)
            .run(...keys.map(key => row[key]), id);
        } else insert('agent_configs', row);
      }
      for (const table of ['agent_skills', 'agent_scheduled_tasks', 'agent_cookbook'] as const)
        for (const row of expected[table]) {
          if (table === 'agent_scheduled_tasks' && row.schedule_type === 'once' && row.enabled &&
              typeof row.next_run_at === 'string' && Date.parse(row.next_run_at) <= Date.now())
            throw new Error('An enabled copied one-shot task is due; refuse unrelated dispatch');
          db.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id);
          insert(table, row);
        }
      for (const table of ['agent_sessions', 'agent_session_messages'] as const)
        for (const row of expected[table]) {
          if (db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(row.id))
            throw new Error('Actual evidence ID collides with fixture history');
          insert(table, row);
        }
      const controlsAfter = snapshot.excludedControlProfiles.map(id => db.prepare('SELECT * FROM agent_configs WHERE id=?').get(id));
      const controlSchedulesAfter = db.prepare("SELECT * FROM agent_scheduled_tasks WHERE agent_config_id='org-reviewer' ORDER BY id").all();
      if (JSON.stringify(controlsAfter) !== JSON.stringify(controlProfiles) ||
          JSON.stringify(controlSchedulesAfter) !== JSON.stringify(controlSchedules))
        throw new Error('Code-owned Reviewer controls changed during actual snapshot import');
      const fk = db.pragma('foreign_key_check') as unknown[];
      if (fk.length) throw new Error('Actual review import created a broken fixture reference');
      for (const [table, rows] of Object.entries(expected)) {
        for (const source of rows) {
          const readback = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(source.id);
          if (!readback || Object.keys(source).some(key => readback[key] !== source[key]))
            throw new Error(`Actual review ${table} readback differs from exact source fields`);
        }
      }
    })();
    return { readbackHashes: Object.fromEntries(Object.entries(expected).map(([table, rows]) =>
      [table, sha256(JSON.stringify(rows.map(row => {
        const readback = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(row.id)!;
        return Object.fromEntries(Object.keys(row).map(key => [key, readback[key]]));
      })))])), selectedSessionIds: [...selectedIds],
      revisionMap: projectedProfileIds.map(id => {
        const source = snapshot.tables.agent_configs.find(row => row.id === id)!;
        const clone = db.prepare('SELECT revision FROM agent_configs WHERE id=?').get(id)!;
        return { id, source: Number(source.revision), clone: Number(clone.revision) };
      }),
      pausedRecurring: expected.agent_scheduled_tasks.filter((row, index) =>
        row.next_run_at !== snapshot.tables.agent_scheduled_tasks[index].next_run_at).length };
  } finally { db.close(); }
}

let seedPlan: ReturnType<typeof seedActualProfiles> | null = null;
const test = packagedTest.extend<{}, { actualProfileSeed: void }>({
  actualProfileSeed: [async ({}, use) => {
    if (!manifestPath || !snapshotPath || !snapshotSha || process.env.RHYTHM_FEATURE_MODEL !== '1')
      throw new Error('Actual snapshot seed requires exact fixture and model authorization');
    const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
    if (!manifest.profileSeedPath || existsSync(manifest.dbPath))
      throw new Error('Actual profile seed must precede first private fixture bootstrap');
    const snapshot = readSnapshot(snapshotPath, snapshotSha, manifest.ownerUserId);
    seedPlan = seedActualProfiles(snapshot, manifest.profileSeedPath, selectedCases(snapshot));
    readQualificationFixture(manifestPath, expectedRevision);
    await use();
  }, { scope: 'worker', auto: true }],
});

if (!manifestPath || !snapshotPath || !snapshotSha || process.env.RHYTHM_FEATURE_MODEL !== '1') {
  unverified(title, () => { throw new Error('UNVERIFIED: packaged fixture, real snapshot path/SHA, and real-model flag are required'); });
} else test(title, async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const { manifest } = readQualificationFixture(manifestPath, expectedRevision);
  expect(manifest.syntheticActor).toBeDefined();
  const loan = manifest.syntheticActor.modelLoan as { issuedAt: number; stopAt: number; expires: number } | undefined;
  expect(loan && loan.issuedAt <= Date.now() && loan.stopAt - Date.now() >= 300_000 &&
    loan.stopAt <= loan.expires - 1_200_000, 'A fresh bounded real-model loan is required').toBe(true);
  const snapshot = readSnapshot(snapshotPath, snapshotSha, manifest.ownerUserId);
  const requested = selectedCases(snapshot);
  expect(seedPlan, 'The actual profile seed must run before packaged backend bootstrap').not.toBeNull();
  const selectedProvenance = snapshot.provenance.filter(row => requested.includes(row.profileId));
  const token = readFileSync(manifest.syntheticActor.tokenPath, 'utf8');
  const api = new ObservedApi(API, { authorization: `Bearer ${token}` });
  expect(await api.json<{ user: { id: number } }>('/auth/me')).toMatchObject({ user: { id: manifest.ownerUserId } });
  const existing = new Set((await api.json<{ jobs: Job[] }>('/agent-org-proposals/evaluations')).jobs.map(job => job.id));
  const imported = importSnapshot(snapshot, manifest.dbPath, manifest.fixtureRoot, requested, seedPlan!.projectedIds);
  const settings = await api.json<{ tokenLimit: number; candidateCount: number }>('/agent-org-proposals/evaluations/settings');
  expect(settings.tokenLimit, 'The actual run must keep the shared default 100,000-token cap').toBe(100_000);
  const nonce = randomUUID().slice(0, 8);
  const taskName = `[smoke] Actual Org Reviewer ${nonce}`;
  const report: Record<string, unknown> = { sourceRevision: expectedRevision, snapshotSha256: snapshotSha,
    sourceCapturedAt: snapshot.capturedAt, selectedProfileIds: requested,
    selectedProvenance: selectedProvenance.map(({ sessionId, profileId, selectionRole, sourceStatus, sourceCreatedAt, sourceMessageCount, sourceRowsSha256 }) =>
      ({ sessionId, profileId, selectionRole, sourceStatus, sourceCreatedAt, sourceMessageCount, sourceRowsSha256,
        insideReviewerSevenDays: Date.parse(sourceCreatedAt) >= Date.now() - 7 * 86_400_000 })),
    omissions: snapshot.omissions, importReadbackHashes: imported.readbackHashes,
    importedSessionIds: imported.selectedSessionIds, pausedRecurringSchedules: imported.pausedRecurring,
    projectedProfileIds: seedPlan!.projectedIds, unprojectedDelegateDependencies: seedPlan!.unprojectedDependencies,
    sourceToCloneRevisions: imported.revisionMap,
    outcome: 'unrun' };
  let reviewerTaskId: string | null = null;
  let cycleId: string | null = null;
  let jobIds: string[] = [];
  let proposalIds: string[] = [];
  let primaryError: unknown;
  try {
    const controls = await api.json<Array<{ id: string; name: string; prompt: string; agentConfigId: string;
      agentKind: string; allowedMcpsJson: string | null; allowedSkillsJson: string | null }>>('/agent-schedules');
    const control = controls.find(row => row.name === 'Org Reviewer' && row.agentConfigId === 'org-reviewer');
    expect(control, 'Current code-owned Reviewer control must remain available').toBeDefined();
    const created = await api.fetch('/agent-schedules', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: taskName, description: 'Private actual-owner snapshot review', scheduleType: 'weekly',
        scheduledDay: 1, scheduledTime: '08:30', timezone: 'America/Los_Angeles', prompt: control!.prompt,
        agentKind: 'opencode', agentConfigId: 'org-reviewer', enabled: true,
        allowedMcps: JSON.parse(control!.allowedMcpsJson ?? '{}'),
        allowedSkills: JSON.parse(control!.allowedSkillsJson ?? '[]') }) });
    expect(created.status).toBe(201);
    reviewerTaskId = String((await created.json() as { id: string }).id);
    await page.goto('rhythm://app/index.html#/tools/tasks');
    const row = page.getByTestId(`schedule-${reviewerTaskId}`);
    await expect(row).toBeVisible(); await row.click();
    const triggered = responseFor(page, 'POST', `/agent-schedules/${reviewerTaskId}/trigger-now`);
    await page.getByTestId('schedule-trigger').click();
    await assertResponse(await triggered, 'POST', `/agent-schedules/${reviewerTaskId}/trigger-now`, 200);
    const deadline = Math.min(Date.now() + 480_000, loan!.stopAt - 20_000);
    let cycle: Job | undefined;
    let jobs: Job[] = [];
    while (Date.now() < deadline) {
      jobs = (await api.json<{ jobs: Job[] }>('/agent-org-proposals/evaluations')).jobs.filter(job => !existing.has(job.id));
      cycle = jobs.find(job => job.budgetRootId === null && job.ownerUserId === manifest.ownerUserId);
      if (cycle) {
        cycleId = cycle.id;
        jobIds = jobs.filter(job => job.id === cycle!.id || job.budgetRootId === cycle!.id).map(job => job.id);
        const proposedDuringCycle = await api.json<Proposal[]>('/agent-org-proposals?status=proposed');
        const leaked = proposedDuringCycle.filter(proposal => jobIds.includes(proposal.preReviewEvaluation?.evaluationId ?? ''));
        if (!['qualified', 'inconclusive', 'failed'].includes(cycle.status))
          expect(leaked, 'No child may queue while the shared cycle is open').toEqual([]);
        if (['qualified', 'inconclusive', 'failed'].includes(cycle.status)) break;
      } else {
        const schedule = await api.json<ReviewerScheduleState>(`/agent-schedules/${reviewerTaskId}`);
        if (assertOwnedReviewerSchedule(schedule, { id: reviewerTaskId, name: taskName, ownerUserId: manifest.ownerUserId })) {
          const runs = await api.json<ReviewerScheduleRun[]>(`/agent-schedules/${reviewerTaskId}/runs?limit=1`);
          throw terminalReviewerScheduleError(schedule, runs);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    expect(cycle, 'UI-triggered Reviewer must create a durable shared-budget cycle').toBeDefined();
    expect(['qualified', 'inconclusive', 'failed']).toContain(cycle!.status);
    const allJobs = (await api.json<{ jobs: Job[] }>('/agent-org-proposals/evaluations')).jobs;
    const children = allJobs.filter(job => job.budgetRootId === cycle!.id);
    jobIds = [cycle!.id, ...children.map(job => job.id)];
    const details = await Promise.all(jobIds.map(id => api.json<Detail>(`/agent-org-proposals/evaluations/${id}`)));
    report.cycle = cycle;
    report.evaluationDetails = details;
    const root = details.find(detail => detail.job.id === cycle!.id)!;
    expect(root.budget.maxTokens).toBe(100_000);
    expect(root.budget.settledTokens + root.budget.outstandingTokens).toBeLessThanOrEqual(100_000);
    if (cycle!.status === 'qualified') {
      expect(root.budget.outstandingTokens).toBe(0);
      expect(root.budget.hasUnknownUsage).toBe(false);
    }
    const frozen = JSON.parse(String((root.job as Job & { inputJson: string }).inputJson)) as {
      context?: { metadata?: { windowDays?: number }; batches?: Array<{
        sessionEvidence?: Array<{ sessionId: string; profileId: string; status: string;
          messages?: Array<{ messageId: string; text: string }> }>;
        profiles?: Array<{ id: string; targetRevision: string; systemPrompt: string | null;
          model: { providerId: string | null; modelId: string | null }; allowedMcps: unknown;
          allowedSkills: unknown; corePermissions: unknown; allowedDelegates: unknown }>;
        omittedConfigurationSummaries?: boolean }> } };
    expect(frozen.context?.metadata?.windowDays, 'Reviewer must use its unchanged seven-day window').toBe(7);
    const batches = frozen.context?.batches ?? [];
    const evidence = batches.flatMap(batch => batch.sessionEvidence ?? []);
    const sourceSessions = new Map(snapshot.tables.agent_sessions.map(row => [String(row.id), row]));
    const sourceMessages = new Map(snapshot.tables.agent_session_messages.map(row => [String(row.sdk_message_id ?? row.id), row]));
    const expectedRecent = selectedProvenance.filter(item => {
      const source = sourceSessions.get(item.sessionId)!;
      const recentAt = Date.parse(String(source.last_activity_at ?? source.updated_at ?? source.created_at));
      return recentAt >= Date.now() - 7 * 86_400_000 && item.sourceMessageCount > 0;
    });
    for (const item of expectedRecent) {
      const matched = evidence.find(row => row.sessionId === item.sessionId);
      expect(matched, `Actual ${item.selectionRole} ${item.sessionId} must reach the Reviewer`).toBeDefined();
      expect(matched).toMatchObject({ profileId: item.profileId, status: item.sourceStatus });
      expect((matched!.messages ?? []).some(message => sourceMessages.has(message.messageId) &&
        typeof message.text === 'string' && message.text.trim().length > 0),
      `Actual ${item.selectionRole} ${item.sessionId} needs a citable stored message`).toBe(true);
    }
    if (requested.includes('secretary')) {
      expect(expectedRecent.filter(item => item.profileId === 'secretary' && item.selectionRole === 'failure').length).toBeGreaterThan(0);
      expect(expectedRecent.filter(item => item.profileId === 'secretary' && item.selectionRole === 'counterexample').length).toBeGreaterThan(0);
    }
    report.contextIncludedSessionIds = evidence.map(row => row.sessionId);
    report.contextOmittedProfiles = requested.filter(id => !batches.some(batch =>
      batch.profiles?.some(profile => profile.id === id)) && batches.some(batch =>
      batch.omittedConfigurationSummaries && batch.sessionEvidence?.some(row => row.profileId === id)));
    for (const id of requested) {
      if ((report.contextOmittedProfiles as string[]).includes(id)) continue;
      const profile = batches.flatMap(batch => batch.profiles ?? []).find(row => row.id === id);
      const source = snapshot.tables.agent_configs.find(row => row.id === id)!;
      expect(profile, `Actual ${id} profile summary cannot disappear`).toBeDefined();
      expect(profile!.targetRevision).toBe(String(source.revision));
      expect(profile!.systemPrompt).toBe(typeof source.system_prompt === 'string'
        ? source.system_prompt.slice(0, 4_000) : source.system_prompt);
      expect(profile!.model).toEqual({ providerId: source.model_provider, modelId: source.model_id });
      expect(profile!.allowedMcps).toEqual(source.allowed_mcps_json === null ? null : JSON.parse(String(source.allowed_mcps_json)));
      expect(profile!.allowedSkills).toEqual(source.allowed_skills_json === null ? null : JSON.parse(String(source.allowed_skills_json)));
      expect(profile!.corePermissions).toEqual(source.core_permissions_json === null ? null : JSON.parse(String(source.core_permissions_json)));
      expect(profile!.allowedDelegates).toEqual(source.allowed_delegates_json === null ? null : JSON.parse(String(source.allowed_delegates_json)));
    }
    report.contextRecentSourceSessionIds = expectedRecent.map(item => item.sessionId);
    const proposed = await api.json<Proposal[]>('/agent-org-proposals?status=proposed');
    const linked = proposed.filter(proposal => jobIds.includes(proposal.preReviewEvaluation?.evaluationId ?? ''));
    proposalIds = linked.map(proposal => proposal.id);
    report.linkedProposals = linked;
    for (const detail of details) {
      expect(detail.budget.settledTokens).toBeLessThanOrEqual(detail.budget.maxTokens);
      if (detail.job.status === 'qualified') {
        expect(detail.budget.outstandingTokens).toBe(0);
        expect(detail.budget.hasUnknownUsage).toBe(false);
      }
    }
    for (const proposal of linked) {
      const child = details.find(detail => detail.job.id === proposal.preReviewEvaluation?.evaluationId);
      expect(cycle!.status, 'No proposal may enter review before shared cycle closes qualified').toBe('qualified');
      expect(child?.job.status, 'Only independently qualified children may enter review').toBe('qualified');
      expect(child!.job.qualifiedProposalId).toBe(proposal.id);
      const original = child!.candidates.find(candidate => candidate.role === 'original');
      const final = child!.candidates.find(candidate => candidate.role === 'final');
      expect(original).toBeDefined(); expect(final).toBeDefined();
      expect(proposal.preReviewEvaluation?.finalCandidateHash).toBe(final!.configHash);
      const originals = child!.results.filter(result => result.candidateId === original!.id && result.phase === 'validation');
      const finals = child!.results.filter(result => result.candidateId === final!.id && result.phase === 'validation');
      expect(originals.length).toBeGreaterThan(0);
      expect(new Set(finals.map(result => result.taskKey))).toEqual(new Set(originals.map(result => result.taskKey)));
      expect(finals.every(result => result.status === 'pass' && result.score === 1)).toBe(true);
      expect(finals.some(result => result.score! > (originals.find(other => other.taskKey === result.taskKey)?.score ?? 1))).toBe(true);
    }
    if (cycle!.status !== 'qualified') expect(linked, 'Inconclusive whole-run budget must never publish').toEqual([]);
    report.outcome = linked.length ? 'qualified-improvement-proved' : 'scan-safety-passed-improvement-unqualified';
    report.unqualifiedReasons = details.filter(detail => detail.job.status !== 'qualified').map(detail =>
      ({ id: detail.job.id, status: detail.job.status, reason: detail.job.failureReason }));
    testInfo.annotations.push({ type: 'org-evaluation-outcome', description: String(report.outcome) });
  } catch (error) {
    primaryError = error;
    const known = cycleId ? [...new Set([cycleId, ...jobIds])] : jobIds;
    report.failureEvaluationDetails = await Promise.all(known.map(async id => {
      try { return await api.json<Detail>(`/agent-org-proposals/evaluations/${id}`); }
      catch { return { id, unavailable: true }; }
    }));
    report.failure = String(error);
    throw error;
  }
  finally {
    const cleanupErrors: string[] = [];
    try {
      if (reviewerTaskId) {
        const owned = await api.json<{ id: string; name: string; createdByUserId: number }>(`/agent-schedules/${reviewerTaskId}`);
        if (owned.name !== taskName || owned.createdByUserId !== manifest.ownerUserId) throw Error('Refusing foreign Reviewer cleanup');
        const deleted = await api.fetch(`/agent-schedules/${reviewerTaskId}`, { method: 'DELETE' });
        if (deleted.status !== 204) throw Error('Owned Reviewer schedule cleanup failed');
      }
    } catch (error) { cleanupErrors.push(String(error)); }
    report.cleanupErrors = cleanupErrors;
    await testInfo.attach('actual-org-review-evaluation.json', { body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: 'application/json' });
    if (cleanupErrors.length && !primaryError) throw Error(cleanupErrors.join('; '));
  }
});
